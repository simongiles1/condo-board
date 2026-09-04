/**
 * Pin-aligned 3D building massing from architectural floor plans.
 * Run: npx tsx --test scripts/test-building-geometry.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBuildingGeometry,
  buildSlabs,
  createSlabBlueprintMaterial,
  DEFAULT_FLOOR_HEIGHT_M,
  DEFAULT_SCALE_DENOMINATOR,
  DEFAULT_SLAB_THICKNESS_M,
  extrudeHighlightedUnitWalls,
  extrudeUnitEnclosureWalls,
  extrudeWalls,
  unitShellRing,
  metresPerPdfPoint,
  modelBounds,
  pdfPointToWorldMetres,
  slabElevationsByFloor,
} from "@/lib/building/building-geometry";
import { MeshBasicMaterial, TextureLoader } from "three";
import type { FloorPlanAnnotation } from "@/lib/building/floor-plan-annotations";
import type {
  FloorPlanDto,
  FloorPlanFamilyDto,
} from "@/lib/building/floor-plan-shared";

function family(
  overrides: Partial<FloorPlanFamilyDto> & { id: string },
): FloorPlanFamilyDto {
  return {
    name: overrides.name ?? "Tower",
    kind: overrides.kind ?? "architectural",
    sortOrder: overrides.sortOrder ?? 0,
    cropWidthPt: overrides.cropWidthPt ?? 200,
    cropHeightPt: overrides.cropHeightPt ?? 100,
    scaleDenominator: overrides.scaleDenominator ?? 100,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function plan(
  overrides: Partial<FloorPlanDto> & { id: string; familyId: string },
): FloorPlanDto {
  return {
    name: overrides.name ?? overrides.id,
    notes: "",
    floorNumber: overrides.floorNumber ?? 1,
    sortOrder: 0,
    originalPageWidthPt: 400,
    originalPageHeightPt: 300,
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
    annotations: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function wall(points: { x: number; y: number }[]): FloorPlanAnnotation {
  return {
    type: "polyline",
    points,
    color: "#dc2626",
    strokeWidthPt: 1,
  };
}

describe("metresPerPdfPoint", () => {
  it("converts 72 points at 1:100 to 2.54 m", () => {
    assert.equal(metresPerPdfPoint(100) * 72, 2.54);
  });

  it("falls back to 1:100 when scale is missing or invalid", () => {
    const expected = metresPerPdfPoint(DEFAULT_SCALE_DENOMINATOR);
    assert.equal(metresPerPdfPoint(null), expected);
    assert.equal(metresPerPdfPoint(undefined), expected);
    assert.equal(metresPerPdfPoint(0), expected);
    assert.equal(metresPerPdfPoint(-50), expected);
  });

  it("scales linearly with the family denominator", () => {
    assert.ok(
      Math.abs(metresPerPdfPoint(150) - metresPerPdfPoint(100) * 1.5) < 1e-12,
    );
  });
});

describe("pdfPointToWorldMetres", () => {
  it("maps the pin to the world origin", () => {
    const pin = { x: 120, y: 80 };
    assert.deepEqual(pdfPointToWorldMetres(pin, pin, 1), { x: 0, z: 0 });
  });

  it("maps PDF +X to world +X and PDF +Y to world -Z", () => {
    const pin = { x: 10, y: 20 };
    const mpp = 0.5;
    assert.deepEqual(
      pdfPointToWorldMetres({ x: 14, y: 20 }, pin, mpp),
      { x: 2, z: 0 },
    );
    assert.deepEqual(
      pdfPointToWorldMetres({ x: 10, y: 24 }, pin, mpp),
      { x: 0, z: -2 },
    );
  });
});

describe("slabElevationsByFloor", () => {
  it("stacks existing basement and above-grade floors without fabricating gaps", () => {
    const elevations = slabElevationsByFloor([-3, -1, 1, 4], 3.5);
    assert.equal(elevations.get(1), 0);
    assert.equal(elevations.get(4), 3.5);
    assert.equal(elevations.get(-1), -3.5);
    assert.equal(elevations.get(-3), -7);
    assert.equal(elevations.has(2), false);
    assert.equal(elevations.has(-2), false);
  });
});

describe("buildBuildingGeometry", () => {
  it("aligns two floors to a shared pin datum", () => {
    const families = [family({ id: "arch", scaleDenominator: 100 })];
    const polyline = wall([
      { x: 100, y: 80 },
      { x: 172, y: 80 },
    ]);
    const payload = {
      families,
      plans: [
        plan({
          id: "f1",
          familyId: "arch",
          floorNumber: 1,
          pinXPt: 100,
          pinYPt: 80,
          annotations: [polyline],
        }),
        plan({
          id: "f2",
          familyId: "arch",
          floorNumber: 2,
          pinXPt: 180,
          pinYPt: 40,
          annotations: [
            wall([
              { x: 180, y: 40 },
              { x: 252, y: 40 },
            ]),
          ],
        }),
      ],
    };
    const model = buildBuildingGeometry(payload);
    assert.equal(model.levels.length, 2);
    const [lower, upper] = model.levels;
    assert.equal(lower.elevationM, 0);
    assert.equal(upper.elevationM, DEFAULT_FLOOR_HEIGHT_M);
    assert.equal(lower.wallPaths[0]![0]!.x, 0);
    assert.equal(lower.wallPaths[0]![0]!.z, 0);
    assert.equal(upper.wallPaths[0]![0]!.x, 0);
    assert.equal(upper.wallPaths[0]![0]!.z, 0);
    assert.equal(lower.wallPaths[0]![1]!.x, 2.54);
    assert.equal(upper.wallPaths[0]![1]!.x, 2.54);
  });

  it("builds slab footprints from the cropped plate around the pin", () => {
    const families = [family({ id: "arch", cropWidthPt: 200, cropHeightPt: 100 })];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({
          id: "f1",
          familyId: "arch",
          cropXPt: 50,
          cropYPt: 40,
          pinXPt: 150,
          pinYPt: 90,
        }),
      ],
    });
    const slab = model.levels[0]!.slab;
    const mpp = metresPerPdfPoint(100);
    assert.ok(Math.abs(slab.width - 200 * mpp) < 1e-9);
    assert.ok(Math.abs(slab.depth - 100 * mpp) < 1e-9);
    assert.ok(Math.abs(slab.centerX - 0) < 1e-9);
    assert.ok(Math.abs(slab.centerZ - 0) < 1e-9);
  });

  it("converts wall polylines into sequential world paths", () => {
    const families = [family({ id: "arch" })];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({
          id: "f1",
          familyId: "arch",
          pinXPt: 0,
          pinYPt: 0,
          annotations: [
            wall([
              { x: 0, y: 0 },
              { x: 72, y: 0 },
              { x: 72, y: 72 },
            ]),
          ],
        }),
      ],
    });
    const walls = extrudeWalls(model);
    assert.equal(walls.length, 2);
    assert.ok(Math.abs(walls[0]!.length - 2.54) < 1e-9);
    assert.ok(Math.abs(walls[1]!.length - 2.54) < 1e-9);
    assert.equal(walls[0]!.height, DEFAULT_FLOOR_HEIGHT_M);
    assert.equal(walls[0]!.position[1], 0);
  });

  it("picks the annotated sheet when two ready plans share a floor", () => {
    const families = [family({ id: "arch" })];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({
          id: "empty",
          familyId: "arch",
          name: "An201",
          floorNumber: 2,
        }),
        plan({
          id: "marked",
          familyId: "arch",
          name: "An202",
          floorNumber: 2,
          annotations: [
            wall([
              { x: 100, y: 80 },
              { x: 110, y: 80 },
            ]),
          ],
        }),
      ],
    });
    assert.equal(model.levels.length, 1);
    assert.equal(model.levels[0]!.planId, "marked");
    assert.equal(model.skipped.length, 1);
    assert.equal(model.skipped[0]!.planId, "empty");
    assert.equal(model.skipped[0]!.reason, "duplicate-floor");
  });

  it("excludes unready architectural sheets and ignores mechanical drawings", () => {
    const families = [
      family({ id: "arch" }),
      family({ id: "mech", kind: "mechanical", name: "Mechanical" }),
    ];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({
          id: "ready",
          familyId: "arch",
          floorNumber: 1,
        }),
        plan({
          id: "no-pin",
          familyId: "arch",
          floorNumber: 3,
          pinXPt: null,
          pinYPt: null,
          status: "cropped",
        }),
        plan({
          id: "no-crop",
          familyId: "arch",
          floorNumber: 4,
          hasCropped: false,
          cropXPt: null,
          cropYPt: null,
          status: "uploaded",
        }),
        plan({
          id: "unmerged",
          familyId: "arch",
          floorNumber: 5,
          hasOriginal: false,
          hasWest: true,
          hasEast: true,
          hasCropped: false,
          status: "unmerged",
        }),
        plan({
          id: "mech-1",
          familyId: "mech",
          floorNumber: 1,
        }),
      ],
    });
    assert.equal(model.levels.map((level) => level.planId).join(","), "ready");
    const reasons = Object.fromEntries(
      model.skipped.map((item) => [item.planId, item.reason]),
    );
    assert.equal(reasons["no-pin"], "no-pin");
    assert.equal(reasons["no-crop"], "not-cropped");
    assert.equal(reasons["unmerged"], "needs-merge");
    assert.equal(reasons["mech-1"], undefined);
  });

  it("places slabs at walking-surface minus half thickness", () => {
    const families = [family({ id: "arch" })];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({ id: "f1", familyId: "arch", floorNumber: 1 }),
        plan({ id: "f2", familyId: "arch", floorNumber: 2 }),
      ],
    });
    const slabs = buildSlabs(model);
    assert.equal(slabs[0]!.position[1], -DEFAULT_SLAB_THICKNESS_M / 2);
    assert.equal(
      slabs[1]!.position[1],
      DEFAULT_FLOOR_HEIGHT_M - DEFAULT_SLAB_THICKNESS_M / 2,
    );
    assert.equal(slabs[0]!.thickness, DEFAULT_SLAB_THICKNESS_M);
  });

  it("computes bounds that enclose stacked slabs", () => {
    const families = [family({ id: "arch" })];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({ id: "p1", familyId: "arch", floorNumber: -1 }),
        plan({ id: "f1", familyId: "arch", floorNumber: 1 }),
      ],
    });
    const bounds = modelBounds(model);
    assert.ok(bounds);
    assert.ok(bounds.min[1] < 0);
    assert.ok(bounds.max[1] >= DEFAULT_FLOOR_HEIGHT_M);
  });

  it("builds slabs with 2D blueprint texture URL and overlay position offset", () => {
    const families = [family({ id: "arch", cropWidthPt: 300, cropHeightPt: 150 })];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({ id: "plan-1", familyId: "arch", floorNumber: 1, cropXPt: 20, cropYPt: 30 }),
      ],
    });
    const slabs = buildSlabs(model);
    assert.equal(slabs.length, 1);
    const slab = slabs[0]!;
    assert.equal(slab.planId, "plan-1");
    assert.equal(slab.textureUrl, "/api/building/floor-plans/plan-1/file?kind=cropped");
    assert.equal(slab.elevationM, 0);
    // Overlay plane elevation is offset by +0.01m above walking surface (Y=0)
    assert.equal(slab.overlayPosition[0], slab.position[0]);
    assert.equal(slab.overlayPosition[1], 0.01);
    assert.equal(slab.overlayPosition[2], slab.position[2]);
  });

  it("creates blueprint material with polygonOffset and depthWrite disabled", () => {
    const mat = createSlabBlueprintMaterial(null, { opacity: 0.65, materialType: "basic" });
    assert.ok(mat instanceof MeshBasicMaterial);
    assert.equal(mat.transparent, true);
    assert.equal(mat.opacity, 0.65);
    assert.equal(mat.depthWrite, false);
    assert.equal(mat.polygonOffset, true);
    assert.equal(mat.polygonOffsetFactor, -1);
    assert.equal(mat.polygonOffsetUnits, -1);
  });

  it("aligns slab UV mapping 1:1 with the cropped PDF drawing and datum pin", () => {
    const families = [
      family({ id: "arch", cropWidthPt: 200, cropHeightPt: 100, scaleDenominator: 100 }),
    ];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({
          id: "plan-uv",
          familyId: "arch",
          floorNumber: 1,
          cropXPt: 50,
          cropYPt: 40,
          pinXPt: 100,
          pinYPt: 80,
        }),
      ],
    });
    const slabs = buildSlabs(model);
    const slab = slabs[0]!;
    const mpp = slab.metresPerPoint;

    // Slab dimensions must match crop plate dimensions in world metres
    assert.equal(slab.width, 200 * mpp);
    assert.equal(slab.depth, 100 * mpp);

    // Verify datum pin location maps correctly inside the slab texture coordinates:
    // Pin at (100, 80) relative to crop origin (50, 40):
    // Normalized PDF offset: U = (100 - 50) / 200 = 0.25; V = (80 - 40) / 100 = 0.40
    const pinWorld = pdfPointToWorldMetres({ x: 100, y: 80 }, { x: 100, y: 80 }, mpp);
    assert.equal(pinWorld.x, 0);
    assert.equal(pinWorld.z, 0);

    // World bounds of the slab:
    const minWorldX = slab.position[0] - slab.width / 2;
    const maxWorldX = slab.position[0] + slab.width / 2;
    const minWorldZ = slab.position[2] - slab.depth / 2;
    const maxWorldZ = slab.position[2] + slab.depth / 2;

    // Pin is at world origin (0, 0)
    const pinU = (0 - minWorldX) / slab.width;
    // World -Z is PDF top (Y=crop.y+crop.height), World +Z is PDF bottom (Y=crop.y)
    const pinV = (maxWorldZ - 0) / slab.depth;

    assert.ok(Math.abs(pinU - (100 - 50) / 200) < 1e-9);
    assert.ok(Math.abs(pinV - (80 - 40) / 100) < 1e-9);
  });

  it("extracts unit rooms and calculates centroids from plan annotations", () => {
    const families = [family({ id: "arch", scaleDenominator: 100 })];
    const mpp = metresPerPdfPoint(100);
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({
          id: "plan-units",
          familyId: "arch",
          floorNumber: 2,
          pinXPt: 0,
          pinYPt: 0,
          annotations: [
            {
              type: "room",
              label: "201",
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
                { x: 0, y: 100 },
              ],
              color: "#0ea5e9",
              strokeWidthPt: 1,
            },
            {
              type: "room",
              label: "202",
              points: [
                { x: 100, y: 0 },
                { x: 200, y: 0 },
                { x: 200, y: 100 },
                { x: 100, y: 100 },
              ],
              color: "#22c55e",
              strokeWidthPt: 1,
            },
          ],
        }),
      ],
    });

    assert.equal(model.units.length, 2);
    const u201 = model.units.find((u) => u.label === "201")!;
    assert.ok(u201);
    assert.equal(u201.unitId, "2:201");
    assert.equal(u201.floorNumber, 2);
    assert.equal(u201.polygon.length, 4);
    assert.ok(Math.abs(u201.center.x - 50 * mpp) < 1e-4);
    assert.ok(Math.abs(u201.center.z - (-50 * mpp)) < 1e-4);
  });

  it("handles multi-polygon units on the same floor with distinct keys and shared unitId", () => {
    const families = [family({ id: "arch", scaleDenominator: 100 })];
    const model = buildBuildingGeometry({
      families,
      plans: [
        plan({
          id: "f7",
          familyId: "arch",
          floorNumber: 7,
          pinXPt: 0,
          pinYPt: 0,
          annotations: [
            {
              type: "room",
              label: "708",
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
                { x: 0, y: 100 },
              ],
              color: "#0ea5e9",
              strokeWidthPt: 1,
            },
            {
              type: "room",
              label: "708",
              points: [
                { x: 100, y: 0 },
                { x: 200, y: 0 },
                { x: 200, y: 100 },
                { x: 100, y: 100 },
              ],
              color: "#0ea5e9",
              strokeWidthPt: 1,
            },
          ],
        }),
      ],
    });

    assert.equal(model.units.length, 2);
    assert.equal(model.units[0]!.unitId, "7:708");
    assert.equal(model.units[1]!.unitId, "7:708");
    assert.notEqual(model.units[0]!.key, model.units[1]!.key);
  });
});

describe("extrudeUnitEnclosureWalls and highlighted unit walls", () => {
  const unitSquare = [
    { x: 0, z: 0 },
    { x: 5, z: 0 },
    { x: 5, z: 5 },
    { x: 0, z: 5 },
  ];

  function levelWithWalls(
    wallPaths: Array<Array<{ x: number; z: number }>>,
    units: Array<{ label: string; polygon: Array<{ x: number; z: number }> }>,
  ) {
    const families = [family({ id: "arch", scaleDenominator: 100 })];
    const annotations: FloorPlanAnnotation[] = [
      ...units.map((u) => ({
        type: "room" as const,
        label: u.label,
        points: u.polygon.map((p) => ({ x: p.x, y: p.z })),
        color: "#0ea5e9",
        strokeWidthPt: 1,
      })),
      ...wallPaths.map((path) => ({
        type: "polyline" as const,
        points: path.map((p) => ({ x: p.x, y: p.z })),
        color: "#000",
        strokeWidthPt: 1,
      })),
    ];
    return buildBuildingGeometry({
      families,
      plans: [
        plan({
          id: "f1",
          familyId: "arch",
          floorNumber: 1,
          pinXPt: 0,
          pinYPt: 0,
          annotations,
        }),
      ],
    });
  }

  it("extrudes four perimeter walls from a unit polygon", () => {
    const model = levelWithWalls([], [{ label: "101", polygon: unitSquare }]);
    const level = model.levels[0]!;
    const unit = model.units[0]!;
    const walls = extrudeUnitEnclosureWalls(
      unit,
      level,
      model.floorHeightM,
      model.wallThicknessM,
    );
    assert.equal(walls.length, 4);
    assert.ok(walls.every((w) => w.touchingUnitIds.includes("1:101")));
  });

  it("does not extrude drawn polylines that lie inside or cross the unit", () => {
    const model = levelWithWalls(
      [
        [
          { x: 2, z: 1 },
          { x: 2, z: 4 },
        ],
        [
          { x: 4, z: 2 },
          { x: 20, z: 2 },
        ],
      ],
      [{ label: "101", polygon: unitSquare }],
    );
    const level = model.levels[0]!;
    const unit = model.units[0]!;
    const walls = extrudeUnitEnclosureWalls(
      unit,
      level,
      model.floorHeightM,
      model.wallThicknessM,
    );
    assert.equal(walls.length, 4);
    const maxX = Math.max(...walls.flatMap((w) => [w.start.x, w.end.x]));
    const polyMaxX = Math.max(...unit.polygon.map((p) => p.x));
    assert.ok(maxX <= polyMaxX + 1e-6);
  });

  it("unitShellRing drops zero-area out-and-back T-stems", () => {
    const ring = unitShellRing([
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 5 },
      { x: 3, z: 5 },
      { x: 3, z: 7 },
      { x: 3, z: 5 },
      { x: 0, z: 5 },
    ]);
    assert.equal(ring.length, 5);
    assert.ok(!ring.some((p) => Math.abs(p.z - 7) < 1e-9));
  });

  it("does not extrude T-stem spikes that enclose no floor", () => {
    const spiked = [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 5 },
      { x: 3, z: 5 },
      { x: 3, z: 7 },
      { x: 3, z: 5 },
      { x: 0, z: 5 },
    ];
    const model = levelWithWalls([], [{ label: "101", polygon: spiked }]);
    const level = model.levels[0]!;
    const unit = model.units[0]!;
    const walls = extrudeUnitEnclosureWalls(
      unit,
      level,
      model.floorHeightM,
      model.wallThicknessM,
    );
    const maxAbsZ = Math.max(
      ...walls.flatMap((w) => [Math.abs(w.start.z), Math.abs(w.end.z)]),
    );
    const polySpikeZ = Math.max(...unit.polygon.map((p) => Math.abs(p.z)));
    assert.ok(polySpikeZ > maxAbsZ + 0.01);
    assert.equal(walls.length, 5);
  });

  it("extrudeHighlightedUnitWalls returns enclosure walls for highlighted units only", () => {
    const model = levelWithWalls(
      [[{ x: 2, z: 1 }, { x: 2, z: 4 }]],
      [
        { label: "101", polygon: unitSquare },
        {
          label: "102",
          polygon: [
            { x: 10, z: 0 },
            { x: 15, z: 0 },
            { x: 15, z: 5 },
            { x: 10, z: 5 },
          ],
        },
      ],
    );
    const highlighted = extrudeHighlightedUnitWalls(model, new Set(["1:101"]));
    assert.equal(highlighted.length, 4);
    assert.ok(highlighted.every((w) => w.touchingUnitIds.includes("1:101")));
  });

  it("extrudeWalls still extrudes all global polylines without unit tagging", () => {
    const model = levelWithWalls(
      [
        [{ x: 0, z: 0 }, { x: 5, z: 0 }],
        [{ x: 10, z: 0 }, { x: 15, z: 0 }],
      ],
      [{ label: "101", polygon: unitSquare }],
    );

    const walls = extrudeWalls(model);
    assert.equal(walls.length, 2);
    assert.ok(walls.every((w) => w.touchingUnitIds.length === 0));
  });
});
