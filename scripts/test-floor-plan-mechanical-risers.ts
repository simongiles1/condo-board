/**
 * Mechanical riser catalog helpers.
 * Run: npx tsx --test scripts/test-floor-plan-mechanical-risers.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DrawColorPreset, FloorPlanAnnotation } from "@/lib/building/floor-plan-annotations";
import { parseDrawColorPresets } from "@/lib/building/floor-plan-annotations";
import {
  architecturalPresetsOnly,
  annotationHasRiser,
  annotationVisibleWhileFollowingRiser,
  applyRiserReclassifyToAnnotations,
  formatMechanicalRiserLabel,
  formatMechanicalRiserLabels,
  groupRisersForFollowMenu,
  groupTaggedRisersByFloor,
  findRiserFocusPoint,
  isMechanicalRiserCallout,
  riserAnnotationFocusPoint,
  mergeDrawColorPresets,
  narrowCalloutToRiser,
  narrowCalloutToRisers,
  parseRiserLabel,
  parseRiserNumber,
  planMechanicalTypeSync,
  resolveCalloutDisplayText,
  type MechanicalRiserDto,
  type MechanicalRiserTypeDto,
} from "@/lib/building/floor-plan-mechanical-risers";

describe("parseRiserLabel", () => {
  it("accepts numeric and alphanumeric labels", () => {
    assert.equal(parseRiserLabel("42"), "42");
    assert.equal(parseRiserLabel("B11"), "B11");
    assert.equal(parseRiserLabel("  B-11  "), "B-11");
  });

  it("rejects empty and invalid characters", () => {
    assert.equal(parseRiserLabel(""), null);
    assert.equal(parseRiserLabel("   "), null);
    assert.equal(parseRiserLabel("bad label!"), null);
  });
});

describe("parseRiserNumber", () => {
  it("accepts whole numbers from 1 to 9999", () => {
    assert.equal(parseRiserNumber(1), 1);
    assert.equal(parseRiserNumber("42"), 42);
    assert.equal(parseRiserNumber("9999"), 9999);
  });

  it("rejects zero, fractions, junk, and alpha", () => {
    assert.equal(parseRiserNumber(0), null);
    assert.equal(parseRiserNumber("0"), null);
    assert.equal(parseRiserNumber(1.5), null);
    assert.equal(parseRiserNumber("B11"), null);
    assert.equal(parseRiserNumber(""), null);
  });
});

describe("formatMechanicalRiserLabel", () => {
  it("joins type name and label", () => {
    assert.equal(formatMechanicalRiserLabel("Sanitary", "3"), "Sanitary 3");
    assert.equal(formatMechanicalRiserLabel("Sanitary", "B11"), "Sanitary B11");
  });
});

describe("isMechanicalRiserCallout", () => {
  it("detects catalog risers and type-only callouts", () => {
    assert.equal(
      isMechanicalRiserCallout({ riserIds: ["r1"], text: "Sanitary 3" }),
      true,
    );
    assert.equal(isMechanicalRiserCallout({ typeId: "t1", text: "" }), true);
    assert.equal(isMechanicalRiserCallout({ text: "Free text" }), false);
  });
});

describe("formatMechanicalRiserLabels", () => {
  it("joins multiple labels with the type name", () => {
    assert.equal(
      formatMechanicalRiserLabels(
        { name: "Riser - Kitchen" },
        ["B2", "B3"],
      ),
      "Riser - Kitchen B2, B3",
    );
  });

  it("ignores keyboard shortcuts on the type", () => {
    assert.equal(
      formatMechanicalRiserLabels(
        { name: "Sanitary" },
        ["11", "12"],
      ),
      "Sanitary 11, 12",
    );
  });

  it("formats three or more labels", () => {
    assert.equal(
      formatMechanicalRiserLabels({ name: "Storm" }, ["4", "5", "6"]),
      "Storm 4, 5, 6",
    );
  });
});

describe("resolveCalloutDisplayText", () => {
  const types = [
    {
      id: "t1",
      name: "Sanitary",
      color: "#0ea5e9",
      sortOrder: 0,
    },
  ];
  const risers = [{ id: "r1", typeId: "t1", label: "4" }];

  it("uses the catalog when riserId is present", () => {
    assert.equal(
      resolveCalloutDisplayText(
        { text: "stale", riserId: "r1" },
        types,
        risers,
      ),
      "Sanitary 4",
    );
  });

  it("formats multiple riser ids on one callout", () => {
    assert.equal(
      resolveCalloutDisplayText(
        { text: "stale", riserIds: ["r1", "r2"] },
        types,
        [
          { id: "r1", typeId: "t1", label: "11" },
          { id: "r2", typeId: "t1", label: "12" },
        ],
      ),
      "Sanitary 11, 12",
    );
  });

  it("falls back to stored text when the riser is missing", () => {
    assert.equal(
      resolveCalloutDisplayText(
        { text: "AHU", riserId: "missing" },
        types,
        risers,
      ),
      "AHU",
    );
  });
});

describe("annotationHasRiser", () => {
  it("matches callout riser ids on a box", () => {
    assert.equal(
      annotationHasRiser(
        {
          type: "rectangle",
          rect: { x: 0, y: 0, width: 10, height: 8 },
          color: "#0ea5e9",
          strokeWidthPt: 2,
          callout: { x: 12, y: 10, text: "Sanitary 4", riserId: "r1", riserIds: ["r1"] },
        },
        "r1",
      ),
      true,
    );
    assert.equal(
      annotationHasRiser(
        {
          type: "polyline",
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
          ],
          color: "#0ea5e9",
          strokeWidthPt: 2,
        },
        "r1",
      ),
      false,
    );
  });
});

describe("annotationVisibleWhileFollowingRiser", () => {
  const polyline: FloorPlanAnnotation = {
    type: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
    color: "#0ea5e9",
    strokeWidthPt: 2,
  };
  const b11Box: FloorPlanAnnotation = {
    type: "rectangle",
    rect: { x: 0, y: 0, width: 10, height: 8 },
    color: "#0ea5e9",
    strokeWidthPt: 2,
    callout: { x: 12, y: 10, text: "B11", riserId: "r1", riserIds: ["r1"] },
  };
  const b12Box: FloorPlanAnnotation = {
    type: "rectangle",
    rect: { x: 20, y: 0, width: 10, height: 8 },
    color: "#0ea5e9",
    strokeWidthPt: 2,
    callout: { x: 32, y: 10, text: "B12", riserId: "r2", riserIds: ["r2"] },
  };

  it("keeps mechanical lines and only followed riser boxes", () => {
    assert.equal(annotationVisibleWhileFollowingRiser(polyline, ["r1"]), true);
    assert.equal(annotationVisibleWhileFollowingRiser(b11Box, ["r1"]), true);
    assert.equal(annotationVisibleWhileFollowingRiser(b12Box, ["r1"]), false);
  });

  it("keeps unlabeled boxes visible while following other risers", () => {
    const unlabeled: FloorPlanAnnotation = {
      type: "rectangle",
      rect: { x: 40, y: 0, width: 10, height: 8 },
      color: "#0ea5e9",
      strokeWidthPt: 2,
    };
    assert.equal(annotationVisibleWhileFollowingRiser(unlabeled, ["r1"]), true);
  });

  it("shows boxes for any followed riser in a multi-select", () => {
    const b12RiserBox: FloorPlanAnnotation = {
      ...b12Box,
      callout: {
        x: 32,
        y: 10,
        text: "B12",
        riserId: "r2",
        riserIds: ["r2", "r3"],
      },
    };
    assert.equal(
      annotationVisibleWhileFollowingRiser(b12RiserBox, ["r2", "r3"]),
      true,
    );
    assert.equal(
      annotationVisibleWhileFollowingRiser(b11Box, ["r2", "r3"]),
      false,
    );
  });
});

describe("narrowCalloutToRiser", () => {
  it("keeps only the followed instance on a multi-riser callout", () => {
    const next = narrowCalloutToRiser(
      {
        x: 1,
        y: 2,
        text: "stale",
        riserIds: ["r1", "r2"],
        riserId: "r1",
      },
      "r2",
      [{ id: "t1", name: "Sanitary", color: "#0ea5e9", sortOrder: 0 }],
      [
        { id: "r1", typeId: "t1", label: "11" },
        { id: "r2", typeId: "t1", label: "12" },
      ],
    );
    assert.equal(next.riserId, "r2");
    assert.deepEqual(next.riserIds, ["r2"]);
    assert.equal(next.text, "Sanitary 12");
  });
});

describe("narrowCalloutToRisers", () => {
  it("keeps a subset and formats a compact multi-label", () => {
    const next = narrowCalloutToRisers(
      {
        x: 1,
        y: 2,
        text: "stale",
        riserIds: ["r1", "r2", "r3"],
      },
      ["r1", "r2"],
      [{ id: "t1", name: "Sanitary", color: "#0ea5e9", shortcut: "B", sortOrder: 0 }],
      [
        { id: "r1", typeId: "t1", label: "11" },
        { id: "r2", typeId: "t1", label: "12" },
        { id: "r3", typeId: "t1", label: "13" },
      ],
    );
    assert.deepEqual(next.riserIds, ["r1", "r2"]);
    assert.equal(next.text, "Sanitary 11, 12");
  });
});

describe("groupRisersForFollowMenu", () => {
  it("puts open stacks first within each type", () => {
    const groups = groupRisersForFollowMenu(
      [
        {
          id: "t1",
          name: "Sanitary",
          color: "#0ea5e9",
          sortOrder: 0,
        },
      ],
      [
        { id: "r2", typeId: "t1", label: "2", completed: true },
        { id: "r1", typeId: "t1", label: "1" },
      ],
    );
    assert.equal(groups[0]?.risers[0]?.id, "r1");
    assert.equal(groups[0]?.risers[1]?.id, "r2");
  });
});

describe("planMechanicalTypeSync", () => {
  const sanitary: DrawColorPreset = {
    color: "#0ea5e9",
    label: "Sanitary",
    family: "mechanical",
    typeId: "t1",
  };

  it("upserts incoming mechanical types and deletes unused ones", () => {
    const plan = planMechanicalTypeSync(
      [sanitary],
      [
        {
          id: "t1",
          name: "Sanitary",
          color: "#0ea5e9",
          sortOrder: 0,
        },
        {
          id: "t2",
          name: "Storm",
          color: "#16a34a",
          sortOrder: 1,
        },
      ],
      [],
    );
    assert.equal(plan.upserts.length, 1);
    assert.deepEqual(plan.deleteIds, ["t2"]);
    assert.deepEqual(plan.blockedNames, []);
  });

  it("blocks deleting a type that still has numbered risers", () => {
    const plan = planMechanicalTypeSync(
      [],
      [
        {
          id: "t1",
          name: "Sanitary",
          color: "#0ea5e9",
          sortOrder: 0,
        },
      ],
      ["t1"],
    );
    assert.deepEqual(plan.deleteIds, []);
    assert.deepEqual(plan.blockedNames, ["Sanitary"]);
  });
});

describe("mergeDrawColorPresets", () => {
  it("keeps architectural JSON rows and appends catalog types", () => {
    const merged = mergeDrawColorPresets(
      [
        { color: "#dc2626", label: "Structural wall", family: "architectural" },
        { color: "#0ea5e9", label: "Old mech", family: "mechanical" },
      ],
      [
        {
          id: "t1",
          name: "Sanitary",
          color: "#0ea5e9",
          shortcut: "s",
          sortOrder: 0,
        },
      ],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.family, "architectural");
    assert.equal(merged[1]?.typeId, "t1");
    assert.equal(merged[1]?.shortcut, "s");
    assert.deepEqual(architecturalPresetsOnly(merged).map((row) => row.family), [
      "architectural",
    ]);
  });
});

describe("applyRiserReclassifyToAnnotations", () => {
  const kitchen = {
    id: "kitchen",
    name: "Kitchen",
    color: "#16a34a",
    sortOrder: 0,
  };
  const toilet = {
    id: "toilet",
    name: "Toilet",
    color: "#0ea5e9",
    sortOrder: 1,
  };
  const types = [kitchen, toilet];

  it("recolors the box and updates callout type when a stack changes type", () => {
    const next = applyRiserReclassifyToAnnotations(
      [
        {
          type: "rectangle",
          rect: { x: 0, y: 0, width: 10, height: 8 },
          color: kitchen.color,
          strokeWidthPt: 2,
          callout: {
            x: 12,
            y: 10,
            text: "Kitchen B11",
            riserId: "k11",
            riserIds: ["k11"],
            typeId: kitchen.id,
          },
        },
        {
          type: "polyline",
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
          ],
          color: kitchen.color,
          strokeWidthPt: 2,
        },
      ],
      { k11: "k11" },
      types,
      [{ id: "k11", typeId: toilet.id, label: "B11" }],
    );
    const box = next[0];
    assert.equal(box?.type, "rectangle");
    if (box?.type !== "rectangle") return;
    assert.equal(box.color, toilet.color);
    assert.equal(box.callout?.typeId, toilet.id);
    assert.equal(box.callout?.text, "Toilet B11");
    assert.equal(next[1]?.type, "polyline");
    if (next[1]?.type === "polyline") {
      assert.equal(next[1].color, kitchen.color);
    }
  });

  it("rewrites merged ids onto the surviving catalog row", () => {
    const next = applyRiserReclassifyToAnnotations(
      [
        {
          type: "rectangle",
          rect: { x: 0, y: 0, width: 10, height: 8 },
          color: kitchen.color,
          strokeWidthPt: 2,
          callout: {
            x: 12,
            y: 10,
            text: "Kitchen B11",
            riserId: "k11",
            riserIds: ["k11"],
            typeId: kitchen.id,
          },
        },
      ],
      { k11: "t11" },
      types,
      [{ id: "t11", typeId: toilet.id, label: "B11" }],
    );
    const box = next[0];
    assert.equal(box?.type, "rectangle");
    if (box?.type !== "rectangle") return;
    assert.deepEqual(box.callout?.riserIds, ["t11"]);
    assert.equal(box.callout?.riserId, "t11");
    assert.equal(box.color, toilet.color);
  });
});

describe("parseDrawColorPresets typeId", () => {
  it("keeps a mechanical type id", () => {
    const parsed = parseDrawColorPresets([
      {
        color: "#0ea5e9",
        label: "Sanitary",
        family: "mechanical",
        typeId: "t1",
        shortcut: "s",
      },
    ]);
    assert.equal(parsed[0]?.typeId, "t1");
  });
});

describe("riserAnnotationFocusPoint", () => {
  it("prefers the callout position over the box center", () => {
    const point = riserAnnotationFocusPoint(
      [
        {
          type: "rectangle",
          rect: { x: 0, y: 0, width: 10, height: 8 },
          color: "#0ea5e9",
          strokeWidthPt: 2,
          callout: {
            x: 22,
            y: 26,
            text: "B11",
            riserId: "r1",
            riserIds: ["r1"],
          },
        },
      ],
      "r1",
    );
    assert.deepEqual(point, { x: 22, y: 26 });
  });

  it("searches annotation lists in order", () => {
    const point = findRiserFocusPoint(
      "r1",
      [],
      [
        {
          type: "rectangle",
          rect: { x: 0, y: 0, width: 10, height: 8 },
          color: "#0ea5e9",
          strokeWidthPt: 2,
          callout: {
            x: 40,
            y: 50,
            text: "B11",
            riserId: "r1",
            riserIds: ["r1"],
          },
        },
      ],
    );
    assert.deepEqual(point, { x: 40, y: 50 });
  });
});

describe("groupTaggedRisersByFloor", () => {
  const kitchen: MechanicalRiserTypeDto = {
    id: "k",
    name: "Riser - Kitchen",
    color: "#f97316",
    sortOrder: 0,
  };
  const hc: MechanicalRiserTypeDto = {
    id: "hc",
    name: "HC",
    color: "#0ea5e9",
    sortOrder: 1,
  };
  const types = [kitchen, hc];
  const risers: MechanicalRiserDto[] = [
    { id: "k-b2", typeId: "k", label: "B2" },
    { id: "k-b3", typeId: "k", label: "B3" },
    { id: "hc-b4", typeId: "hc", label: "B-4" },
  ];

  function box(
    riserIds: string[],
    markupSet?: 1 | 2,
  ): FloorPlanAnnotation {
    const item: FloorPlanAnnotation = {
      type: "rectangle",
      rect: { x: 0, y: 0, width: 10, height: 8 },
      color: "#0ea5e9",
      strokeWidthPt: 2,
      callout: {
        x: 12,
        y: 10,
        text: riserIds.join(","),
        riserId: riserIds[0],
        riserIds,
      },
    };
    if (markupSet === 2) item.markupSet = 2;
    return item;
  }

  it("groups by floor, then type order, then numeric label", () => {
    const grouped = groupTaggedRisersByFloor(
      [
        {
          floorNumber: 2,
          current: true,
          annotations: [box(["hc-b4"])],
        },
        {
          floorNumber: 1,
          annotations: [box(["k-b3", "k-b2"])],
        },
      ],
      types,
      risers,
    );
    assert.deepEqual(
      grouped.map((floor) => floor.floorNumber),
      [1, 2],
    );
    assert.equal(grouped[0]?.current, false);
    assert.equal(grouped[1]?.current, true);
    assert.deepEqual(
      grouped[0]?.types.map((group) => group.type.id),
      ["k"],
    );
    assert.deepEqual(
      grouped[0]?.types[0]?.risers.map((riser) => ({
        label: riser.label,
        approved: riser.approved,
      })),
      [
        { label: "B2", approved: true },
        { label: "B3", approved: true },
      ],
    );
    assert.deepEqual(
      grouped[1]?.types.map((group) => group.type.id),
      ["k", "hc"],
    );
    assert.deepEqual(
      grouped[1]?.types
        .find((group) => group.type.id === "hc")
        ?.risers.map((riser) => ({
          label: riser.label,
          approved: riser.approved,
        })),
      [{ label: "B-4", approved: true }],
    );
    assert.deepEqual(
      grouped[1]?.types
        .find((group) => group.type.id === "k")
        ?.risers.map((riser) => ({
          label: riser.label,
          approved: riser.approved,
        })),
      [
        { label: "B2", approved: false },
        { label: "B3", approved: false },
      ],
    );
  });

  it("treats risers tagged on the floor below as unapproved until tagged here", () => {
    const grouped = groupTaggedRisersByFloor(
      [
        {
          planId: "p1",
          floorNumber: 1,
          current: true,
          annotations: [box(["k-b2", "k-b3"])],
        },
        {
          planId: "p2",
          floorNumber: 2,
          annotations: [box(["k-b2"])],
        },
      ],
      types,
      risers,
    );
    const first = grouped.find((floor) => floor.floorNumber === 1);
    const second = grouped.find((floor) => floor.floorNumber === 2);
    assert.deepEqual(
      first?.types
        .flatMap((group) => group.risers)
        .map((riser) => ({ id: riser.id, approved: riser.approved })),
      [{ id: "k-b2", approved: true }, { id: "k-b3", approved: true }],
    );
    assert.deepEqual(
      second?.types
        .flatMap((group) => group.risers)
        .map((riser) => ({ id: riser.id, approved: riser.approved })),
      [
        { id: "k-b2", approved: true },
        { id: "k-b3", approved: false },
      ],
    );
  });

  it("does not treat followed-but-not-below risers as unapproved", () => {
    const grouped = groupTaggedRisersByFloor(
      [
        {
          planId: "p1",
          floorNumber: 1,
          current: true,
          annotations: [box(["k-b2"])],
        },
        {
          planId: "p2",
          floorNumber: 2,
          annotations: [],
        },
      ],
      types,
      risers,
    );
    const first = grouped.find((floor) => floor.floorNumber === 1);
    const second = grouped.find((floor) => floor.floorNumber === 2);
    assert.deepEqual(
      first?.types.flatMap((group) => group.risers).map((riser) => riser.id),
      ["k-b2"],
    );
    assert.deepEqual(
      second?.types
        .flatMap((group) => group.risers)
        .map((riser) => ({ id: riser.id, approved: riser.approved })),
      [{ id: "k-b2", approved: false }],
    );
  });

  it("omits dismissed followed risers on a floor", () => {
    const grouped = groupTaggedRisersByFloor(
      [
        {
          planId: "p1",
          floorNumber: 1,
          annotations: [box(["k-b2"])],
        },
        {
          planId: "p2",
          floorNumber: 2,
          annotations: [],
        },
      ],
      types,
      risers,
      {
        followSkipped: [{ planId: "p2", riserId: "k-b2" }],
      },
    );
    const second = grouped.find((floor) => floor.floorNumber === 2);
    assert.equal(second?.types.length, 0);
  });

  it("treats extraApprovedIds as already tagged on that floor", () => {
    const grouped = groupTaggedRisersByFloor(
      [
        {
          planId: "p1",
          floorNumber: 1,
          annotations: [box(["k-b2"])],
        },
        {
          planId: "p2",
          floorNumber: 2,
          current: true,
          annotations: [],
        },
      ],
      types,
      risers,
      { extraApprovedIdsByFloor: { 2: ["k-b2"] } },
    );
    const second = grouped.find((floor) => floor.floorNumber === 2);
    assert.deepEqual(
      second?.types
        .flatMap((group) => group.risers)
        .map((riser) => ({ id: riser.id, approved: riser.approved })),
      [{ id: "k-b2", approved: true }],
    );
  });

  it("merges the same floor from multiple families and keeps empty floors", () => {
    const grouped = groupTaggedRisersByFloor(
      [
        { floorNumber: 1, annotations: [box(["k-b2"])] },
        { floorNumber: 1, current: true, annotations: [box(["hc-b4"])] },
        { floorNumber: 0, annotations: [] },
      ],
      types,
      risers,
    );
    assert.equal(grouped.length, 2);
    const ground = grouped.find((floor) => floor.floorNumber === 0);
    const first = grouped.find((floor) => floor.floorNumber === 1);
    assert.equal(ground?.types.length, 0);
    assert.equal(first?.current, true);
    assert.deepEqual(
      first?.types.map((group) => group.type.id),
      ["k", "hc"],
    );
  });
});
