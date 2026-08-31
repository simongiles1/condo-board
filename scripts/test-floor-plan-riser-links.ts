/**
 * Riser-offset pair tests.
 * Run: npx tsx --test scripts/test-floor-plan-riser-links.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { overlayAnnotationsForEditSheet } from "@/lib/building/floor-plan-compare-annotations";
import {
  parseFloorPlanAnnotations,
  type FloorPlanAnnotation,
  type FloorPlanRectangleAnnotation,
} from "@/lib/building/floor-plan-annotations";
import {
  annotationsForHigherFloor,
  clearDanglingRiserLinks,
  connectRiserBoxes,
  disconnectRiserBox,
  hitTestConnectableBox,
  listRiserPairs,
  riserArrowEndpoints,
} from "@/lib/building/floor-plan-riser-links";

function box(
  x: number,
  y: number,
  extras: Partial<FloorPlanRectangleAnnotation> = {},
): FloorPlanRectangleAnnotation {
  return {
    type: "rectangle",
    rect: { x, y, width: 10, height: 8 },
    color: "#16a34a",
    strokeWidthPt: 2,
    ...extras,
  };
}

function line(): FloorPlanAnnotation {
  return {
    type: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
    color: "#dc2626",
    strokeWidthPt: 2,
  };
}

describe("connectRiserBoxes", () => {
  it("marks the first box as above and the second as below", () => {
    const next = connectRiserBoxes([box(0, 0), box(20, 0), line()], 0, 1);
    assert.ok(next);
    assert.equal(next![0].type, "rectangle");
    assert.equal(next![1].type, "rectangle");
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.equal(next![0].riserRole, "above");
    assert.equal(next![1].riserRole, "below");
    assert.equal(next![0].riserPartnerId, next![1].id);
    assert.equal(next![1].riserPartnerId, next![0].id);
    assert.equal(next![2].type, "polyline");
  });

  it("returns the same array when the pair already exists", () => {
    const linked = connectRiserBoxes([box(0, 0), box(20, 0)], 0, 1);
    assert.ok(linked);
    const again = connectRiserBoxes(linked!, 0, 1);
    assert.equal(again, linked);
  });

  it("replaces an existing pair when a box is relinked", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    assert.ok(first);
    const next = connectRiserBoxes(first!, 0, 2);
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    if (next![2].type !== "rectangle") return;
    assert.equal(next![0].riserRole, "above");
    assert.equal(next![2].riserRole, "below");
    assert.equal(next![1].riserRole, undefined);
    assert.equal(next![1].riserPartnerId, undefined);
  });

  it("returns null when linking a box to itself", () => {
    assert.equal(connectRiserBoxes([box(0, 0)], 0, 0), null);
  });
});

describe("disconnectRiserBox", () => {
  it("clears both sides of the pair", () => {
    const linked = connectRiserBoxes([box(0, 0), box(20, 0)], 0, 1);
    assert.ok(linked);
    const next = disconnectRiserBox(linked!, 0);
    if (next[0].type !== "rectangle" || next[1].type !== "rectangle") return;
    assert.equal(next[0].riserRole, undefined);
    assert.equal(next[1].riserRole, undefined);
    assert.equal(next[0].id, undefined);
    assert.equal(next[1].id, undefined);
  });
});

describe("annotationsForHigherFloor", () => {
  it("keeps unpaired boxes and lines, drops the lower box of a pair", () => {
    const linked = connectRiserBoxes(
      [box(0, 0), box(20, 0), box(40, 0), line()],
      0,
      1,
    );
    assert.ok(linked);
    const next = annotationsForHigherFloor(linked!);
    assert.equal(next.length, 3);
    assert.equal(next[0].type, "rectangle");
    assert.equal(next[1].type, "rectangle");
    assert.equal(next[2].type, "polyline");
    if (next[0].type !== "rectangle") return;
    assert.equal(next[0].rect.x, 0);
    assert.equal(next[0].riserRole, undefined);
    assert.equal(next[0].id, undefined);
    if (next[1].type !== "rectangle") return;
    assert.equal(next[1].rect.x, 40);
  });

  it("copies a dangling below box that has no valid partner", () => {
    const dangling: FloorPlanAnnotation[] = [
      box(0, 0, {
        id: "a",
        riserPartnerId: "missing",
        riserRole: "below",
      }),
      box(20, 0),
    ];
    const next = annotationsForHigherFloor(dangling);
    assert.equal(next.length, 2);
    if (next[0].type !== "rectangle") return;
    assert.equal(next[0].riserRole, undefined);
    assert.equal(next[0].rect.x, 0);
  });
});

describe("clearDanglingRiserLinks", () => {
  it("strips a leftover above box after its partner is removed", () => {
    const linked = connectRiserBoxes([box(0, 0), box(20, 0)], 0, 1);
    assert.ok(linked);
    const remaining = clearDanglingRiserLinks([linked![0]]);
    if (remaining[0].type !== "rectangle") return;
    assert.equal(remaining[0].riserRole, undefined);
  });
});

describe("parseFloorPlanAnnotations riser fields", () => {
  it("round-trips a complete pair", () => {
    const linked = connectRiserBoxes([box(0, 0), box(20, 0)], 0, 1);
    assert.ok(linked);
    const parsed = parseFloorPlanAnnotations(JSON.stringify(linked));
    const pairs = listRiserPairs(parsed);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].aboveIndex, 0);
    assert.equal(pairs[0].belowIndex, 1);
  });

  it("drops incomplete riser fields", () => {
    const parsed = parseFloorPlanAnnotations([
      {
        type: "rectangle",
        rect: { x: 0, y: 0, width: 10, height: 8 },
        color: "#16a34a",
        strokeWidthPt: 2,
        id: "only-id",
        riserRole: "above",
      },
    ]);
    assert.equal(parsed.length, 1);
    if (parsed[0].type !== "rectangle") return;
    assert.equal(parsed[0].id, undefined);
    assert.equal(parsed[0].riserRole, undefined);
  });
});

describe("hitTestConnectableBox", () => {
  it("hits a rectangle interior and ignores polylines", () => {
    const annotations = [line(), box(10, 10)];
    assert.equal(hitTestConnectableBox({ x: 15, y: 14 }, annotations, 0), 1);
    assert.equal(hitTestConnectableBox({ x: 1, y: 0 }, annotations, 0), null);
  });
});

describe("riserArrowEndpoints", () => {
  it("starts on the above box and ends on the below box", () => {
    const above = box(0, 20);
    const below = box(30, 0);
    const ends = riserArrowEndpoints(above, below);
    assert.ok(ends);
    assert.ok(ends!.start.x >= 0 && ends!.start.x <= 10);
    assert.ok(ends!.end.x >= 30 && ends!.end.x <= 40);
  });
});

describe("overlayAnnotationsForEditSheet riser pairs", () => {
  it("maps only the above box onto an empty higher floor", () => {
    const linked = connectRiserBoxes([box(110, 210), box(200, 210)], 0, 1);
    assert.ok(linked);
    const plans = [
      {
        id: "f10",
        familyId: "layout",
        floorNumber: 10,
        name: "Floor 10",
        annotations: linked!,
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f11",
        familyId: "layout",
        floorNumber: 11,
        name: "Floor 11",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const families = [{ id: "layout", scaleDenominator: 150 }];
    const mapped = overlayAnnotationsForEditSheet(
      plans[1],
      families[0],
      plans,
      families,
      { x: 105, y: 205 },
    );
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].type, "rectangle");
    if (mapped[0].type !== "rectangle") return;
    assert.equal(mapped[0].riserRole, undefined);
    assert.equal(mapped[0].rect.x, 115);
  });
});
