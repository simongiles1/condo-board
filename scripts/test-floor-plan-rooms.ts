/**
 * Closed-room detection from polyline walls.
 * Run: npx tsx --test scripts/test-floor-plan-rooms.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PdfPoint } from "@/lib/building/floor-plan-align";
import {
  offsetAnnotation,
  parseFloorPlanAnnotations,
  type FloorPlanAnnotation,
} from "@/lib/building/floor-plan-annotations";
import {
  buildRoomLeakIndex,
  enclosingRoomFace,
  findMatchingRoomIndex,
  listFloorPlanRooms,
  nextRoomColor,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  roomDisplayColor,
  ROOM_FILL_COLORS,
  roomLeaksAtPoint,
  roomPolygonsEqual,
} from "@/lib/building/floor-plan-rooms";

function wall(points: PdfPoint[]): FloorPlanAnnotation {
  return {
    type: "polyline",
    points,
    color: "#2563eb",
    strokeWidthPt: 1,
  };
}

function squareWalls(
  x: number,
  y: number,
  size: number,
): FloorPlanAnnotation[] {
  return [
    wall([
      { x, y },
      { x: x + size, y },
    ]),
    wall([
      { x: x + size, y },
      { x: x + size, y: y + size },
    ]),
    wall([
      { x: x + size, y: y + size },
      { x, y: y + size },
    ]),
    wall([
      { x, y: y + size },
      { x, y },
    ]),
  ];
}

describe("polygon helpers", () => {
  it("reports positive area and centroid for a CCW unit square", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    assert.equal(polygonArea(square), 100);
    assert.deepEqual(polygonCentroid(square), { x: 5, y: 5 });
    assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
    assert.equal(pointInPolygon({ x: 20, y: 5 }, square), false);
  });

  it("treats rings equal after rotation and reversed winding", () => {
    const a = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const b = [
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    assert.equal(roomPolygonsEqual(a, b), true);
  });
});

describe("enclosingRoomFace", () => {
  it("highlights a square closed by four walls", () => {
    const face = enclosingRoomFace({ x: 5, y: 5 }, squareWalls(0, 0, 10), 0.5);
    assert.ok(face);
    assert.equal(face!.area, 100);
    assert.equal(roomPolygonsEqual(face!.points, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]), true);
  });

  it("returns null for an open U that is not enclosed", () => {
    const walls = [
      wall([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      wall([
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
      wall([
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ];
    assert.equal(enclosingRoomFace({ x: 5, y: 5 }, walls, 0.5), null);
  });

  it("closes a loop drawn as one polyline that returns to its start", () => {
    const walls = [
      wall([
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 6 },
        { x: 0, y: 6 },
        { x: 0, y: 0 },
      ]),
    ];
    const face = enclosingRoomFace({ x: 3, y: 3 }, walls, 0.5);
    assert.ok(face);
    assert.equal(face!.area, 48);
  });

  it("splits a long wall at a T-junction so two units stay separate", () => {
    const walls = [
      ...squareWalls(0, 0, 20),
      wall([
        { x: 10, y: 0 },
        { x: 10, y: 20 },
      ]),
    ];
    const left = enclosingRoomFace({ x: 5, y: 10 }, walls, 0.5);
    const right = enclosingRoomFace({ x: 15, y: 10 }, walls, 0.5);
    assert.ok(left);
    assert.ok(right);
    assert.equal(left!.area, 200);
    assert.equal(right!.area, 200);
    assert.equal(roomPolygonsEqual(left!.points, right!.points), false);
  });

  it("picks the smaller of two nested rooms", () => {
    const walls = [...squareWalls(0, 0, 20), ...squareWalls(5, 5, 6)];
    const inner = enclosingRoomFace({ x: 8, y: 8 }, walls, 0.5);
    const outer = enclosingRoomFace({ x: 2, y: 2 }, walls, 0.5);
    assert.ok(inner);
    assert.ok(outer);
    assert.equal(inner!.area, 36);
    assert.ok(outer!.area > inner!.area);
  });

  it("ignores a riser rectangle inside a unit", () => {
    const walls: FloorPlanAnnotation[] = [
      ...squareWalls(0, 0, 10),
      {
        type: "rectangle",
        rect: { x: 4, y: 4, width: 2, height: 2 },
        color: "#dc2626",
        strokeWidthPt: 1,
      },
    ];
    const face = enclosingRoomFace({ x: 5, y: 5 }, walls, 0.5);
    assert.ok(face);
    assert.equal(face!.area, 100);
  });

  it("finds an existing room with the same polygon", () => {
    const face = enclosingRoomFace({ x: 5, y: 5 }, squareWalls(0, 0, 10), 0.5);
    assert.ok(face);
    const annotations: FloorPlanAnnotation[] = [
      {
        type: "room",
        points: face!.points,
        label: "1201",
        color: "#0ea5e9",
        strokeWidthPt: 1,
      },
    ];
    assert.equal(findMatchingRoomIndex(annotations, face!.points), 0);
    assert.equal(
      findMatchingRoomIndex(annotations, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]),
      null,
    );
  });
});

describe("room annotations persist", () => {
  it("round-trips a labeled unit polygon", () => {
    const parsed = parseFloorPlanAnnotations([
      {
        type: "room",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 8 },
          { x: 0, y: 8 },
        ],
        label: "1204",
        color: "#2563eb",
        strokeWidthPt: 1,
      },
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.type, "room");
    if (parsed[0]?.type !== "room") return;
    assert.equal(parsed[0].label, "1204");
    assert.equal(parsed[0].points.length, 4);
  });

  it("drops rooms without a closed ring", () => {
    const parsed = parseFloorPlanAnnotations([
      {
        type: "room",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        label: "x",
        color: "#2563eb",
        strokeWidthPt: 1,
      },
    ]);
    assert.equal(parsed.length, 0);
  });

  it("translates room vertices with offsetAnnotation", () => {
    const moved = offsetAnnotation(
      {
        type: "room",
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
          { x: 0, y: 3 },
        ],
        label: "A",
        color: "#2563eb",
        strokeWidthPt: 1,
      },
      2,
      -1,
    );
    assert.equal(moved.type, "room");
    if (moved.type !== "room") return;
    assert.deepEqual(moved.points[0], { x: 2, y: -1 });
    assert.equal(moved.label, "A");
  });
});

describe("room colors", () => {
  const room = (label: string): FloorPlanAnnotation => ({
    type: "room",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    label,
    color: "#000000",
    strokeWidthPt: 1,
  });

  it("cycles distinct colors for new rooms", () => {
    const one = [room("A")];
    assert.equal(nextRoomColor(one), ROOM_FILL_COLORS[1]);
    assert.equal(nextRoomColor([...one, room("B")]), ROOM_FILL_COLORS[2]);
  });

  it("assigns display colors by room order on the floor", () => {
    const annotations: FloorPlanAnnotation[] = [
      wall([{ x: 0, y: 0 }, { x: 1, y: 0 }]),
      room("PH101"),
      wall([{ x: 2, y: 0 }, { x: 3, y: 0 }]),
      room("PH102"),
    ];
    assert.equal(roomDisplayColor(annotations, 1), ROOM_FILL_COLORS[0]);
    assert.equal(roomDisplayColor(annotations, 3), ROOM_FILL_COLORS[1]);
    assert.notEqual(
      roomDisplayColor(annotations, 1),
      roomDisplayColor(annotations, 3),
    );
  });

  it("lists rooms sorted by unit label", () => {
    const annotations: FloorPlanAnnotation[] = [
      room("PH102"),
      wall([{ x: 0, y: 0 }, { x: 1, y: 0 }]),
      room("PH101"),
    ];
    const listed = listFloorPlanRooms(annotations);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]?.label, "PH101");
    assert.equal(listed[1]?.label, "PH102");
    assert.equal(listed[0]?.index, 2);
    assert.equal(listed[1]?.index, 0);
  });
});

function leakMid(leak: { a: PdfPoint; b: PdfPoint }): PdfPoint {
  return {
    x: (leak.a.x + leak.b.x) / 2,
    y: (leak.a.y + leak.b.y) / 2,
  };
}

describe("room leaks", () => {
  it("does not flag a fully closed square", () => {
    const index = buildRoomLeakIndex(squareWalls(0, 0, 20), 0.5, 8);
    assert.equal(roomLeaksAtPoint({ x: 10, y: 10 }, index).length, 0);
  });

  it("glows the hairline gap that opens a square into the hallway", () => {
    const walls = [
      wall([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ]),
      wall([
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ]),
      wall([
        { x: 20, y: 20 },
        { x: 12, y: 20 },
      ]),
      wall([
        { x: 8, y: 20 },
        { x: 0, y: 20 },
      ]),
      wall([
        { x: 0, y: 20 },
        { x: 0, y: 0 },
      ]),
    ];
    const index = buildRoomLeakIndex(walls, 0.5, 8);
    const leaks = roomLeaksAtPoint({ x: 10, y: 10 }, index);
    assert.equal(leaks.length, 1);
    const mid = leakMid(leaks[0]!);
    assert.ok(Math.abs(mid.x - 10) < 1);
    assert.ok(Math.abs(mid.y - 20) < 1);
    assert.ok(leaks[0]!.width > 3 && leaks[0]!.width < 5);
  });

  it("ignores a doorway wider than the leak threshold", () => {
    const walls = [
      wall([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ]),
      wall([
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ]),
      wall([
        { x: 20, y: 20 },
        { x: 30, y: 20 },
      ]),
      wall([
        { x: -10, y: 20 },
        { x: 0, y: 20 },
      ]),
      wall([
        { x: 0, y: 20 },
        { x: 0, y: 0 },
      ]),
    ];
    const index = buildRoomLeakIndex(walls, 0.5, 8);
    assert.equal(roomLeaksAtPoint({ x: 10, y: 10 }, index).length, 0);
  });

  it("flags a T-junction that does not quite reach the crossbar", () => {
    const walls = [
      ...squareWalls(0, 0, 20),
      wall([
        { x: 10, y: 20 },
        { x: 10, y: 0.8 },
      ]),
    ];
    const index = buildRoomLeakIndex(walls, 0.5, 8);
    const leaks = roomLeaksAtPoint({ x: 5, y: 10 }, index);
    assert.ok(leaks.length >= 1);
    const mid = leakMid(leaks[0]!);
    assert.ok(Math.abs(mid.x - 10) < 1.5);
    assert.ok(mid.y >= -0.5 && mid.y <= 5);
  });

  it("shows the partition gap from inside a unit that leaked into the lobby", () => {
    const walls = [
      ...squareWalls(0, 0, 40),
      wall([
        { x: 20, y: 0 },
        { x: 20, y: 36 },
      ]),
    ];
    const index = buildRoomLeakIndex(walls, 0.5, 8);
    const leaks = roomLeaksAtPoint({ x: 10, y: 20 }, index);
    assert.equal(leaks.length, 1);
    const mid = leakMid(leaks[0]!);
    assert.ok(Math.abs(mid.x - 20) < 1);
    assert.ok(mid.y > 35);
  });
});
