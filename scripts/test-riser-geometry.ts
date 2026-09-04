/**
 * Tests for Phase 2 3D riser sweep geometry and TubeGeometry generation.
 * Run: npx tsx --test scripts/test-riser-geometry.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRiserGeometry,
  createFilletedCurve,
  createRiserTubeGeometry,
  DEFAULT_BEND_RADIUS_M,
  DEFAULT_PIPE_RADIUS_M,
  type Point3D,
} from "@/lib/building/riser-geometry";
import type {
  FloorPlanDto,
  FloorPlanFamilyDto,
  FloorPlansPayload,
} from "@/lib/building/floor-plan-shared";

function mockFamily(
  id: string,
  overrides?: Partial<FloorPlanFamilyDto>,
): FloorPlanFamilyDto {
  return {
    id,
    name: overrides?.name ?? "Mech Family",
    kind: overrides?.kind ?? "mechanical",
    sortOrder: 0,
    cropWidthPt: 200,
    cropHeightPt: 100,
    scaleDenominator: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockPlan(
  id: string,
  familyId: string,
  floorNumber: number,
  annotations: FloorPlanDto["annotations"] = [],
): FloorPlanDto {
  return {
    id,
    name: `Floor ${floorNumber}`,
    notes: "",
    familyId,
    floorNumber,
    sortOrder: floorNumber,
    originalPageWidthPt: 500,
    originalPageHeightPt: 400,
    cropXPt: 50,
    cropYPt: 40,
    pinXPt: 100,
    pinYPt: 80,
    referenceAnchorXPt: null,
    referenceAnchorYPt: null,
    westPageWidthPt: null,
    westPageHeightPt: null,
    eastPageWidthPt: null,
    eastPageHeightPt: null,
    eastOffsetXPt: null,
    eastOffsetYPt: null,
    westCropXPt: null,
    westCropYPt: null,
    westCropWidthPt: null,
    westCropHeightPt: null,
    eastCropXPt: null,
    eastCropYPt: null,
    eastCropWidthPt: null,
    eastCropHeightPt: null,
    hasOriginal: true,
    hasCropped: true,
    hasWest: false,
    hasEast: false,
    status: "pinned",
    annotations,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function mockRiserBox(
  x: number,
  y: number,
  riserId: string,
  role?: "above" | "below",
  partnerId?: string,
) {
  return {
    type: "rectangle" as const,
    rect: { x, y, width: 10, height: 10 },
    color: "#3d9e81",
    strokeWidthPt: 1,
    riserRole: role,
    riserPartnerId: partnerId,
    callout: {
      x: x + 15,
      y: y + 15,
      text: "Riser Box",
      riserId,
      riserIds: [riserId],
    },
  };
}

describe("createFilletedCurve", () => {
  it("creates line segments for collinear points", () => {
    const pts: Point3D[] = [
      [0, 0, 0],
      [0, 3.5, 0],
      [0, 7.0, 0],
    ];
    const curve = createFilletedCurve(pts, DEFAULT_BEND_RADIUS_M);
    assert.ok(curve.curves.length >= 1);
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    assert.ok(Math.abs(start.y - 0) < 1e-4);
    assert.ok(Math.abs(end.y - 7.0) < 1e-4);
  });

  it("fillets a 90-degree jog corner into line + quadratic bezier + line", () => {
    const pts: Point3D[] = [
      [0, 0, 0],
      [0, 3.5, 0],
      [2.0, 3.5, 0],
    ];
    const curve = createFilletedCurve(pts, 0.25);
    // Should have: Line to fillet start, QuadraticBezier curve around corner, Line to end
    assert.equal(curve.curves.length, 3);
    assert.equal(curve.curves[1]?.type, "QuadraticBezierCurve3");
  });

  it("returns empty curve for fewer than 2 points", () => {
    const curve = createFilletedCurve([[0, 0, 0]]);
    assert.equal(curve.curves.length, 0);
  });
});

describe("createRiserTubeGeometry", () => {
  it("generates a valid volumetric TubeGeometry from sequential 3D points", () => {
    const pts: Point3D[] = [
      [0, 0, 0],
      [0, 3.5, 0],
      [1.5, 3.5, 0],
      [1.5, 7.0, 0],
    ];
    const tube = createRiserTubeGeometry(pts, {
      pipeRadiusM: DEFAULT_PIPE_RADIUS_M,
      bendRadiusM: 0.2,
    });
    assert.ok(tube);
    assert.ok(tube.attributes.position.count > 100);
    assert.ok(tube.index != null && tube.index.count > 0);
  });

  it("returns null when fewer than 2 points are provided", () => {
    assert.equal(createRiserTubeGeometry([]), null);
    assert.equal(createRiserTubeGeometry([[0, 0, 0]]), null);
  });
});

describe("buildRiserGeometry", () => {
  it("extracts nodes and builds continuous 3D pipes across multiple floors", () => {
    const fam = mockFamily("fam1");
    const p1 = mockPlan("p1", "fam1", 1, [mockRiserBox(120, 80, "riser-1")]);
    const p2 = mockPlan("p2", "fam1", 2, [mockRiserBox(120, 80, "riser-1")]);
    const p3 = mockPlan("p3", "fam1", 3, [mockRiserBox(120, 80, "riser-1")]);

    const payload: Pick<FloorPlansPayload, "families" | "plans" | "settings"> = {
      families: [fam],
      plans: [p1, p2, p3],
      settings: {
        registrationLabel: "Pin",
        pinXPt: 100,
        pinYPt: 80,
        registrationPlanId: "p1",
        pinReferencePlanId: null,
        drawColorPresets: [
          {
            color: "#3d9e81",
            label: "Riser - Laundry",
            family: "mechanical",
            typeId: "type-laundry",
          },
        ],
        mechanicalRisers: [
          {
            id: "riser-1",
            typeId: "type-laundry",
            label: "L1",
            completed: true,
          },
        ],
      },
    };

    const model = buildRiserGeometry(payload);
    assert.equal(model.risers.length, 1);
    const r = model.risers[0]!;
    assert.equal(r.riserId, "riser-1");
    assert.equal(r.label, "L1");
    assert.equal(r.systemName, "Riser - Laundry");
    assert.equal(r.systemColor, "#3d9e81");
    assert.equal(r.minFloor, 1);
    assert.equal(r.maxFloor, 3);
    assert.ok(r.points.length >= 3);
    assert.ok(r.totalLengthM > 5);

    // Terminal equipment generated
    assert.equal(model.equipment.length, 2);
    assert.ok(model.equipment.some((e) => e.key === "equip-base-riser-1"));
    assert.ok(model.equipment.some((e) => e.key === "equip-top-riser-1"));
  });

  it("handles horizontal offset jogs correctly on floors with below and above partners", () => {
    const fam = mockFamily("fam1");
    // Floor 1: straight
    const p1 = mockPlan("p1", "fam1", 1, [mockRiserBox(120, 80, "riser-jog")]);
    // Floor 2: offset pair! below box at (120, 80) jogs to above box at (160, 80)
    const p2 = mockPlan("p2", "fam1", 2, [
      mockRiserBox(120, 80, "riser-jog", "below", "partner-above"),
      mockRiserBox(160, 80, "riser-jog", "above", "partner-below"),
    ]);
    // Floor 3: straight from the new position (160, 80)
    const p3 = mockPlan("p3", "fam1", 3, [mockRiserBox(160, 80, "riser-jog")]);

    const payload: Pick<FloorPlansPayload, "families" | "plans" | "settings"> = {
      families: [fam],
      plans: [p1, p2, p3],
      settings: {
        registrationLabel: "Pin",
        pinXPt: 100,
        pinYPt: 80,
        registrationPlanId: "p1",
        pinReferencePlanId: null,
        drawColorPresets: [
          {
            color: "#f03d8a",
            label: "Riser - Kitchen",
            family: "mechanical",
            typeId: "type-kitchen",
          },
        ],
        mechanicalRisers: [
          {
            id: "riser-jog",
            typeId: "type-kitchen",
            label: "K1",
            completed: false,
          },
        ],
      },
    };

    const model = buildRiserGeometry(payload);
    assert.equal(model.risers.length, 1);
    const r = model.risers[0]!;

    // Verify jog points exist: should contain points at both X coordinates
    const xs = r.points.map((p) => p[0]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    assert.ok(maxX - minX > 0.5, "Riser path should include horizontal jog span");
  });

  it("populates connectedFloors and nodeCount on RiserDescriptor for Phase 3 inspection", () => {
    const fam = mockFamily("fam1");
    const p1 = mockPlan("p1", "fam1", 1, [mockRiserBox(120, 80, "riser-inspect")]);
    const p2 = mockPlan("p2", "fam1", 2, [mockRiserBox(120, 80, "riser-inspect")]);
    const p3 = mockPlan("p3", "fam1", 5, [mockRiserBox(120, 80, "riser-inspect")]);

    const payload: Pick<FloorPlansPayload, "families" | "plans" | "settings"> = {
      families: [fam],
      plans: [p1, p2, p3],
      settings: {
        registrationLabel: "Pin",
        pinXPt: 100,
        pinYPt: 80,
        registrationPlanId: "p1",
        pinReferencePlanId: null,
        drawColorPresets: [
          {
            color: "#3d9e81",
            label: "Sanitary",
            family: "mechanical",
            typeId: "type-sanitary",
          },
        ],
        mechanicalRisers: [
          {
            id: "riser-inspect",
            typeId: "type-sanitary",
            label: "B-20",
            completed: true,
          },
        ],
      },
    };

    const model = buildRiserGeometry(payload);
    assert.equal(model.risers.length, 1);
    const r = model.risers[0]!;
    assert.equal(r.label, "B-20");
    assert.equal(r.systemName, "Sanitary");
    assert.equal(r.completed, true);
    assert.deepEqual(r.connectedFloors, [1, 2, 5]);
    assert.equal(r.nodeCount, 3);
    assert.equal(r.minFloor, 1);
    assert.equal(r.maxFloor, 5);
    assert.ok(r.totalLengthM > 0);
  });
});
