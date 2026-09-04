/**
 * Riser-offset pair tests.
 * Run: npx tsx --test scripts/test-floor-plan-riser-links.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { overlayAnnotationsForEditSheet, followedRiserOverlayAnnotations, applyFollowedRiserOffsets, overlayAnnotationsMatchingRisers, stampCalloutsFromMatchingOverlays, riserIdsAdoptedFromMatchingBoxes } from "@/lib/building/floor-plan-compare-annotations";
import {
  annotationPdfBounds,
  annotationRotationDeg,
  offsetAnnotation,
  parseFloorPlanAnnotations,
  rotationFromPointerDrag,
  snapAnnotationRotationDeg,
  type FloorPlanAnnotation,
  type FloorPlanRectangleAnnotation,
} from "@/lib/building/floor-plan-annotations";
import {
  annotationsForHigherFloor,
  calloutCopiedOnConnect,
  clearDanglingRiserLinks,
  connectNeedsRiserChoice,
  connectRiserBoxes,
  disconnectRiserBox,
  hitTestConnectableBox,
  hitTestRiserPair,
  listRiserPairs,
  placeAndConnectRiserBox,
  placeRiserBoxFromSource,
  reverseRiserPair,
  riserArrowEndpoints,
  riserPartnerIds,
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
    assert.equal(next![0].riserPartnerIds, undefined);
    assert.equal(next![2].type, "polyline");
  });

  it("returns the same array when the pair already exists", () => {
    const linked = connectRiserBoxes([box(0, 0), box(20, 0)], 0, 1);
    assert.ok(linked);
    const again = connectRiserBoxes(linked!, 0, 1);
    assert.equal(again, linked);
  });

  it("adds a second pair when an above box is linked to another below", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    assert.ok(first);
    const next = connectRiserBoxes(first!, 0, 2);
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    if (next![2].type !== "rectangle") return;
    assert.equal(next![0].riserRole, "above");
    assert.equal(next![1].riserRole, "below");
    assert.equal(next![2].riserRole, "below");
    assert.deepEqual(riserPartnerIds(next![0]), [next![1].id, next![2].id]);
    assert.equal(listRiserPairs(next!).length, 2);
  });

  it("adds a second pair when a below box is linked to another above", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    assert.ok(first);
    const next = connectRiserBoxes(first!, 2, 1);
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    if (next![2].type !== "rectangle") return;
    assert.equal(next![0].riserRole, "above");
    assert.equal(next![1].riserRole, "below");
    assert.equal(next![2].riserRole, "above");
    assert.deepEqual(riserPartnerIds(next![1]), [next![0].id, next![2].id]);
    assert.equal(listRiserPairs(next!).length, 2);
  });

  it("keeps the hub role when the second click order is reversed", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    assert.ok(first);
    const next = connectRiserBoxes(first!, 1, 2);
    assert.ok(next);
    if (next![1].type !== "rectangle" || next![2].type !== "rectangle") return;
    assert.equal(next![1].riserRole, "below");
    assert.equal(next![2].riserRole, "above");
    assert.equal(listRiserPairs(next!).length, 2);
  });

  it("returns null when linking a box to itself", () => {
    assert.equal(connectRiserBoxes([box(0, 0)], 0, 0), null);
  });

  it("duplicates a callout onto the partner when only one box has a callout", () => {
    const next = connectRiserBoxes(
      [
        box(0, 0, { callout: { x: 30, y: 30, text: "Riser 2" } }),
        box(20, 0),
      ],
      0,
      1,
    );
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.equal(next![0].callout?.text, "Riser 2");
    assert.equal(next![1].callout?.text, "Riser 2");
    assert.notEqual(next![0].callout?.x, next![1].callout?.x);
  });

  it("copies only the chosen riser ids onto the unlabeled partner", () => {
    const types = [
      { id: "t1", name: "Sanitary", color: "#0ea5e9", shortcut: "B", sortOrder: 0 },
    ];
    const risers = [
      { id: "r1", typeId: "t1", label: "11" },
      { id: "r2", typeId: "t1", label: "12" },
    ];
    const next = connectRiserBoxes(
      [
        box(0, 0, {
          callout: {
            x: 30,
            y: 30,
            text: "B-11, 12",
            riserId: "r1",
            riserIds: ["r1", "r2"],
            typeId: "t1",
          },
        }),
        box(20, 0),
      ],
      0,
      1,
      { copyRiserIds: ["r1"], types, risers },
    );
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.deepEqual(next![0].callout?.riserIds, ["r1", "r2"]);
    assert.deepEqual(next![1].callout?.riserIds, ["r1"]);
    assert.equal(next![1].callout?.text, "Sanitary 11");
  });

  it("copies two of three riser ids when a combined shaft splits", () => {
    const types = [
      { id: "t1", name: "Sanitary", color: "#0ea5e9", shortcut: "B", sortOrder: 0 },
    ];
    const risers = [
      { id: "r1", typeId: "t1", label: "11" },
      { id: "r2", typeId: "t1", label: "12" },
      { id: "r3", typeId: "t1", label: "13" },
    ];
    const next = connectRiserBoxes(
      [
        box(0, 0),
        box(20, 0, {
          callout: {
            x: 50,
            y: 40,
            text: "B-11, 12, 13",
            riserIds: ["r1", "r2", "r3"],
            typeId: "t1",
          },
        }),
      ],
      0,
      1,
      { copyRiserIds: ["r1", "r2"], types, risers },
    );
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.deepEqual(next![0].callout?.riserIds, ["r1", "r2"]);
    assert.equal(next![0].callout?.text, "Sanitary 11, 12");
    assert.deepEqual(next![1].callout?.riserIds, ["r1", "r2", "r3"]);
  });

  it("duplicates a callout from the below box onto the above box", () => {
    const next = connectRiserBoxes(
      [
        box(0, 0),
        box(20, 0, { callout: { x: 50, y: 40, text: "AHU" } }),
      ],
      0,
      1,
    );
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.equal(next![0].callout?.text, "AHU");
    assert.equal(next![1].callout?.text, "AHU");
  });

  it("leaves both callouts unchanged when each box already has one", () => {
    const next = connectRiserBoxes(
      [
        box(0, 0, { callout: { x: 30, y: 30, text: "Top" } }),
        box(20, 0, { callout: { x: 50, y: 40, text: "Bottom" } }),
      ],
      0,
      1,
    );
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.equal(next![0].callout?.text, "Top");
    assert.equal(next![1].callout?.text, "Bottom");
  });
});

describe("placeRiserBoxFromSource", () => {
  it("centers a same-size copy without linking the pair", () => {
    const source = box(10, 20, {
      callout: {
        x: 30,
        y: 30,
        text: "Kitchen B2",
        riserIds: ["r1"],
        typeId: "t1",
      },
      id: "src",
      riserRole: "above",
      riserPartnerId: "other",
    });
    const placed = placeRiserBoxFromSource(source, { x: 100, y: 50 });
    assert.equal(placed.type, "rectangle");
    assert.equal(placed.rect.x, 95);
    assert.equal(placed.rect.y, 46);
    assert.equal(placed.rect.width, 10);
    assert.equal(placed.rect.height, 8);
    assert.equal(placed.id, undefined);
    assert.equal(placed.riserRole, undefined);
    assert.equal(placed.riserPartnerId, undefined);
    assert.deepEqual(placed.callout?.riserIds, ["r1"]);
    assert.equal(placed.callout?.text, "Kitchen B2");
  });

  it("copies only the chosen subset onto the new box", () => {
    const types = [
      { id: "t1", name: "Kitchen", color: "#16a34a", shortcut: "K", sortOrder: 0 },
    ];
    const risers = [
      { id: "r1", typeId: "t1", label: "B2" },
      { id: "r2", typeId: "t1", label: "B3" },
    ];
    const source = box(0, 0, {
      callout: {
        x: 20,
        y: 20,
        text: "Kitchen B2, B3",
        riserIds: ["r1", "r2"],
        typeId: "t1",
      },
    });
    const placed = placeRiserBoxFromSource(source, { x: 40, y: 16 }, {
      copyRiserIds: ["r1"],
      types,
      risers,
    });
    assert.deepEqual(placed.callout?.riserIds, ["r1"]);
    assert.equal(placed.callout?.text, "Kitchen B2");
    assert.deepEqual(source.callout?.riserIds, ["r1", "r2"]);
  });
});

describe("placeAndConnectRiserBox", () => {
  it("marks the new box above and the existing box below", () => {
    const source = box(10, 20, {
      callout: {
        x: 30,
        y: 30,
        text: "Kitchen B2, B3",
        riserIds: ["r1", "r2"],
        typeId: "t1",
      },
    });
    const next = placeAndConnectRiserBox(
      [source, line()],
      source,
      { x: 100, y: 50 },
      0,
    );
    assert.ok(next);
    assert.equal(next!.length, 3);
    if (next![0].type !== "rectangle" || next![2].type !== "rectangle") return;
    assert.equal(next![0].riserRole, "below");
    assert.equal(next![2].riserRole, "above");
    assert.equal(next![0].riserPartnerId, next![2].id);
    assert.deepEqual(next![0].callout?.riserIds, ["r1", "r2"]);
    assert.deepEqual(next![2].callout?.riserIds, ["r1", "r2"]);
    const ends = riserArrowEndpoints(next![2], next![0]);
    assert.ok(ends);
    assert.ok(ends!.end.x >= 10 && ends!.end.x <= 20);
  });

  it("writes an overlay source onto this floor as the below box", () => {
    const overlay = box(0, 0, {
      callout: { x: 20, y: 20, text: "Kitchen B2", riserIds: ["r1"] },
    });
    const next = placeAndConnectRiserBox([], overlay, { x: 40, y: 16 }, null);
    assert.ok(next);
    assert.equal(next!.length, 2);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.equal(next![0].riserRole, "below");
    assert.equal(next![1].riserRole, "above");
    assert.equal(next![0].rect.x, 0);
    assert.equal(next![1].rect.x, 35);
  });

  it("copies a chosen subset onto the ABV box only", () => {
    const types = [
      { id: "t1", name: "Kitchen", color: "#16a34a", shortcut: "K", sortOrder: 0 },
    ];
    const risers = [
      { id: "r1", typeId: "t1", label: "B2" },
      { id: "r2", typeId: "t1", label: "B3" },
    ];
    const source = box(0, 0, {
      callout: {
        x: 20,
        y: 20,
        text: "Kitchen B2, B3",
        riserIds: ["r1", "r2"],
        typeId: "t1",
      },
    });
    const next = placeAndConnectRiserBox(
      [source],
      source,
      { x: 40, y: 16 },
      0,
      { copyRiserIds: ["r1"], types, risers },
    );
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.deepEqual(next![0].callout?.riserIds, ["r1", "r2"]);
    assert.deepEqual(next![1].callout?.riserIds, ["r1"]);
    assert.equal(next![1].callout?.text, "Kitchen B2");
    assert.equal(next![1].riserRole, "above");
  });

  it("places a second ABV from the same below source", () => {
    const source = box(0, 0, {
      callout: {
        x: 20,
        y: 20,
        text: "Toilet B11, B12",
        riserIds: ["r1", "r2"],
        typeId: "t1",
      },
    });
    const first = placeAndConnectRiserBox(
      [source],
      source,
      { x: 40, y: 16 },
      0,
    );
    assert.ok(first);
    const next = placeAndConnectRiserBox(
      first!,
      first![0] as FloorPlanRectangleAnnotation,
      { x: 80, y: 16 },
      0,
    );
    assert.ok(next);
    assert.equal(listRiserPairs(next!).length, 2);
    if (next![0].type !== "rectangle") return;
    assert.equal(next![0].riserRole, "below");
    assert.equal(riserPartnerIds(next![0]).length, 2);
  });
});

describe("hitTestConnectableBox visibility", () => {
  it("skips boxes the caller marks hidden", () => {
    const annotations = [box(0, 0), box(20, 0)];
    const hit = hitTestConnectableBox(
      { x: 25, y: 4 },
      annotations,
      0,
      (_item, index) => index === 0,
    );
    assert.equal(hit, null);
  });
});

describe("calloutCopiedOnConnect", () => {
  it("returns the labeled callout when the partner is unlabeled", () => {
    const labeled = box(0, 0, {
      callout: { x: 1, y: 1, text: "B-11, 12", riserIds: ["r1", "r2"] },
    });
    const blank = box(20, 0);
    assert.equal(calloutCopiedOnConnect(labeled, blank), labeled.callout);
    assert.equal(calloutCopiedOnConnect(blank, labeled), labeled.callout);
    assert.equal(connectNeedsRiserChoice(labeled.callout!), true);
  });

  it("returns null when both boxes already have callouts", () => {
    const a = box(0, 0, { callout: { x: 1, y: 1, text: "A" } });
    const b = box(20, 0, { callout: { x: 2, y: 2, text: "B" } });
    assert.equal(calloutCopiedOnConnect(a, b), null);
  });
});

describe("reverseRiserPair", () => {
  it("swaps above and below roles while keeping partner ids", () => {
    const linked = connectRiserBoxes([box(0, 0), box(20, 0)], 0, 1);
    assert.ok(linked);
    const reversed = reverseRiserPair(linked!, 0, 1);
    assert.ok(reversed);
    if (reversed![0].type !== "rectangle" || reversed![1].type !== "rectangle") {
      return;
    }
    assert.equal(reversed![0].riserRole, "below");
    assert.equal(reversed![1].riserRole, "above");
    assert.equal(reversed![0].riserPartnerId, reversed![1].id);
    assert.equal(reversed![1].riserPartnerId, reversed![0].id);
    const pairs = listRiserPairs(reversed!);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].aboveIndex, 1);
    assert.equal(pairs[0].belowIndex, 0);
  });

  it("does not reverse a split with more than one partner", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    const split = connectRiserBoxes(first!, 2, 1);
    assert.ok(split);
    assert.equal(reverseRiserPair(split!, 0, 1), null);
  });
});

describe("hitTestRiserPair", () => {
  it("hits the arrow between linked boxes", () => {
    const linked = connectRiserBoxes([box(0, 20), box(30, 0)], 0, 1);
    assert.ok(linked);
    const pairs = listRiserPairs(linked!);
    assert.equal(pairs.length, 1);
    const ends = riserArrowEndpoints(pairs[0].above, pairs[0].below);
    assert.ok(ends);
    const mid = {
      x: (ends!.start.x + ends!.end.x) / 2,
      y: (ends!.start.y + ends!.end.y) / 2,
    };
    assert.equal(hitTestRiserPair(mid, linked!, 2), pairs[0].above.id);
    assert.equal(hitTestRiserPair({ x: -50, y: -50 }, linked!, 2), null);
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

  it("keeps the other branch when one split box is disconnected", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    const split = connectRiserBoxes(first!, 2, 1);
    assert.ok(split);
    const next = disconnectRiserBox(split!, 0);
    if (next[0].type !== "rectangle" || next[1].type !== "rectangle") return;
    if (next[2].type !== "rectangle") return;
    assert.equal(next[0].riserRole, undefined);
    assert.equal(next[1].riserRole, "below");
    assert.equal(next[2].riserRole, "above");
    assert.equal(listRiserPairs(next).length, 1);
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

  it("keeps both above boxes when one below splits into two", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    const split = connectRiserBoxes(first!, 2, 1);
    assert.ok(split);
    const next = annotationsForHigherFloor(split!);
    assert.equal(next.length, 2);
    if (next[0].type !== "rectangle" || next[1].type !== "rectangle") return;
    assert.equal(next[0].rect.x, 0);
    assert.equal(next[1].rect.x, 40);
    assert.equal(next[0].riserRole, undefined);
    assert.equal(next[1].riserRole, undefined);
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

  it("keeps the remaining split after an above box is deleted", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    const split = connectRiserBoxes(first!, 2, 1);
    assert.ok(split);
    const remaining = clearDanglingRiserLinks(split!.filter((_, i) => i !== 0));
    assert.equal(listRiserPairs(remaining).length, 1);
    if (remaining[0].type !== "rectangle" || remaining[1].type !== "rectangle") {
      return;
    }
    assert.equal(remaining[0].riserRole, "below");
    assert.equal(remaining[1].riserRole, "above");
    assert.equal(riserPartnerIds(remaining[0]).length, 1);
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

  it("round-trips a combined shaft with two arrows", () => {
    const first = connectRiserBoxes([box(0, 0), box(20, 0), box(40, 0)], 0, 1);
    const split = connectRiserBoxes(first!, 2, 1);
    assert.ok(split);
    const parsed = parseFloorPlanAnnotations(JSON.stringify(split));
    assert.equal(listRiserPairs(parsed).length, 2);
    if (parsed[1]?.type !== "rectangle") return;
    assert.equal(riserPartnerIds(parsed[1]).length, 2);
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

describe("followedRiserOverlayAnnotations", () => {
  const types = [
    { id: "t1", name: "Sanitary", color: "#0ea5e9", sortOrder: 0 },
  ];
  const risers = [
    { id: "r1", typeId: "t1", label: "11" },
    { id: "r2", typeId: "t1", label: "12" },
  ];

  function labeledBox(
    x: number,
    y: number,
    riserId: string,
  ): FloorPlanRectangleAnnotation {
    return box(x, y, {
      callout: {
        x: x + 12,
        y: y + 10,
        text: "stale",
        riserId,
        riserIds: [riserId],
      },
    });
  }

  function overlayArgs(
    plans: Parameters<typeof followedRiserOverlayAnnotations>[0]["plans"],
    families: { id: string; scaleDenominator: number }[],
    planIndex: number,
    extra: Partial<Parameters<typeof followedRiserOverlayAnnotations>[0]> = {},
  ) {
    return followedRiserOverlayAnnotations({
      plans,
      families,
      plan: plans[planIndex],
      family: families.find((item) => item.id === plans[planIndex].familyId) ?? families[0],
      riserIds: ["r1"],
      markupSet: 1,
      types,
      risers,
      currentAnnotations: [],
      anchorPin: {
        x: plans[planIndex].pinXPt!,
        y: plans[planIndex].pinYPt!,
      },
      ...extra,
    });
  }

  it("maps the followed box from the floor immediately below", () => {
    const plans = [
      {
        id: "f10",
        familyId: "layout",
        floorNumber: 10,
        name: "Floor 10",
        annotations: [labeledBox(110, 210, "r1"), labeledBox(200, 210, "r2")],
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
    const overlay = overlayArgs(plans, [{ id: "layout", scaleDenominator: 150 }], 1);
    assert.equal(overlay.length, 1);
    assert.equal(overlay[0]?.type, "rectangle");
    if (overlay[0]?.type !== "rectangle") return;
    assert.equal(overlay[0].callout?.riserId, "r1");
    assert.deepEqual(overlay[0].callout?.riserIds, ["r1"]);
    assert.equal(overlay[0].callout?.text, "Sanitary 11");
    assert.equal(overlay[0].rect.x, 115);
  });

  it("does not overlay when this floor already has the riser", () => {
    const current = [labeledBox(110, 210, "r1")];
    const plans = [
      {
        id: "f10",
        familyId: "layout",
        floorNumber: 10,
        name: "Floor 10",
        annotations: [labeledBox(110, 210, "r1")],
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
        annotations: current,
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const overlay = overlayArgs(
      plans,
      [{ id: "layout", scaleDenominator: 150 }],
      1,
      { currentAnnotations: current },
    );
    assert.equal(overlay.length, 0);
  });

  it("does not overlay when this floor already has an unlabeled matching box", () => {
    const plans = [
      {
        id: "f10",
        familyId: "layout",
        floorNumber: 10,
        name: "Floor 10",
        annotations: [labeledBox(110, 210, "r1")],
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
    const mapped = overlayArgs(plans, [{ id: "layout", scaleDenominator: 150 }], 1);
    assert.equal(mapped.length, 1);
    const unlabeled =
      mapped[0] && mapped[0].type === "rectangle"
        ? { ...mapped[0], callout: undefined }
        : mapped[0];
    const overlay = overlayArgs(
      plans,
      [{ id: "layout", scaleDenominator: 150 }],
      1,
      { currentAnnotations: unlabeled ? [unlabeled] : [] },
    );
    assert.equal(overlay.length, 0);
  });

  it("maps from a lower floor in a different family", () => {
    const plans = [
      {
        id: "f1",
        familyId: "floor-1-m",
        floorNumber: 1,
        name: "M-305",
        annotations: [labeledBox(110, 210, "r1")],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f2",
        familyId: "floor-2-m",
        floorNumber: 2,
        name: "M-307",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const overlay = overlayArgs(
      plans,
      [
        { id: "floor-1-m", scaleDenominator: 150 },
        { id: "floor-2-m", scaleDenominator: 150 },
      ],
      1,
    );
    assert.equal(overlay.length, 1);
    if (overlay[0]?.type !== "rectangle") return;
    assert.equal(overlay[0].rect.x, 115);
  });

  it("uses the floor immediately below, not a floor further down", () => {
    const plans = [
      {
        id: "f1",
        familyId: "floor-1-m",
        floorNumber: 1,
        name: "M-305",
        annotations: [labeledBox(110, 210, "r1")],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f2",
        familyId: "floor-2-m",
        floorNumber: 2,
        name: "M-307",
        annotations: [labeledBox(200, 210, "r1")],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f3",
        familyId: "floor-3-m",
        floorNumber: 3,
        name: "M-309",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const overlay = overlayArgs(
      plans,
      [
        { id: "floor-1-m", scaleDenominator: 150 },
        { id: "floor-2-m", scaleDenominator: 150 },
        { id: "floor-3-m", scaleDenominator: 150 },
      ],
      2,
    );
    assert.equal(overlay.length, 1);
    if (overlay[0]?.type !== "rectangle") return;
    assert.equal(overlay[0].rect.x, 205);
  });

  it("does not skip an empty floor below to reach a lower one", () => {
    const plans = [
      {
        id: "f1",
        familyId: "floor-1-m",
        floorNumber: 1,
        name: "M-305",
        annotations: [labeledBox(110, 210, "r1")],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f2",
        familyId: "floor-2-m",
        floorNumber: 2,
        name: "M-307",
        annotations: [],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f3",
        familyId: "floor-3-m",
        floorNumber: 3,
        name: "M-309",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const overlay = overlayArgs(
      plans,
      [
        { id: "floor-1-m", scaleDenominator: 150 },
        { id: "floor-2-m", scaleDenominator: 150 },
        { id: "floor-3-m", scaleDenominator: 150 },
      ],
      2,
    );
    assert.equal(overlay.length, 0);
  });

  it("maps a Pass 2 box from the floor below onto Pass 2", () => {
    const pass2 = {
      ...labeledBox(110, 210, "r1"),
      markupSet: 2 as const,
    };
    const plans = [
      {
        id: "f1",
        familyId: "floor-1-m",
        floorNumber: 1,
        name: "M-305",
        annotations: [pass2],
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f2",
        familyId: "floor-2-m",
        floorNumber: 2,
        name: "M-307",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
    const overlay = overlayArgs(
      plans,
      [
        { id: "floor-1-m", scaleDenominator: 150 },
        { id: "floor-2-m", scaleDenominator: 150 },
      ],
      1,
      { markupSet: 2 },
    );
    assert.equal(overlay.length, 1);
    if (overlay[0]?.type !== "rectangle") return;
    assert.equal(overlay[0].markupSet, 2);
    assert.equal(overlay[0].rect.x, 115);
  });

  function combinedBox(
    x: number,
    y: number,
    riserIds: string[],
  ): FloorPlanRectangleAnnotation {
    return box(x, y, {
      callout: {
        x: x + 12,
        y: y + 10,
        text: "stale",
        riserId: riserIds[0],
        riserIds,
      },
    });
  }

  function stackedPlans(belowAnnotations: FloorPlanAnnotation[]) {
    return [
      {
        id: "f1",
        familyId: "layout",
        floorNumber: 1,
        name: "Floor 1",
        annotations: belowAnnotations,
        pinXPt: 100,
        pinYPt: 200,
        cropXPt: 50,
        cropYPt: 40,
      },
      {
        id: "f2",
        familyId: "layout",
        floorNumber: 2,
        name: "Floor 2",
        annotations: [],
        pinXPt: 105,
        pinYPt: 205,
        cropXPt: 55,
        cropYPt: 45,
      },
    ];
  }

  it("keeps every catalog id on a combined callout", () => {
    const overlay = overlayArgs(
      stackedPlans([combinedBox(110, 210, ["r1", "r2"])]),
      [{ id: "layout", scaleDenominator: 150 }],
      1,
      { riserIds: ["r2"] },
    );
    assert.equal(overlay.length, 1);
    if (overlay[0]?.type !== "rectangle") return;
    assert.deepEqual(overlay[0].callout?.riserIds, ["r1", "r2"]);
    assert.equal(overlay[0].callout?.text, "Sanitary 11, 12");
  });

  it("overlays a combined box once when following every id on it", () => {
    const overlay = overlayArgs(
      stackedPlans([combinedBox(110, 210, ["r1", "r2"])]),
      [{ id: "layout", scaleDenominator: 150 }],
      1,
      { riserIds: ["r1", "r2"] },
    );
    assert.equal(overlay.length, 1);
    if (overlay[0]?.type !== "rectangle") return;
    assert.deepEqual(overlay[0].callout?.riserIds, ["r1", "r2"]);
  });

  it("drops a combined id already saved on this floor", () => {
    const current = [labeledBox(110, 210, "r1")];
    const overlay = overlayArgs(
      stackedPlans([combinedBox(110, 210, ["r1", "r2"])]),
      [{ id: "layout", scaleDenominator: 150 }],
      1,
      { riserIds: ["r2"], currentAnnotations: current },
    );
    assert.equal(overlay.length, 1);
    if (overlay[0]?.type !== "rectangle") return;
    assert.deepEqual(overlay[0].callout?.riserIds, ["r2"]);
    assert.equal(overlay[0].callout?.text, "Sanitary 12");
  });

  it("drops a dismissed id from a combined callout", () => {
    const overlay = overlayArgs(
      stackedPlans([combinedBox(110, 210, ["r1", "r2"])]),
      [{ id: "layout", scaleDenominator: 150 }],
      1,
      { riserIds: ["r2"], skippedRiserIds: ["r1"] },
    );
    assert.equal(overlay.length, 1);
    if (overlay[0]?.type !== "rectangle") return;
    assert.deepEqual(overlay[0].callout?.riserIds, ["r2"]);
    assert.equal(overlay[0].callout?.text, "Sanitary 12");
  });
});

describe("offsetAnnotation", () => {
  it("moves a labeled box and its callout together", () => {
    const item: FloorPlanRectangleAnnotation = {
      type: "rectangle",
      rect: { x: 10, y: 20, width: 8, height: 6 },
      color: "#0ea5e9",
      strokeWidthPt: 2,
      callout: { x: 22, y: 26, text: "B11", riserId: "r1", riserIds: ["r1"] },
    };
    const moved = offsetAnnotation(item, 3, -1);
    assert.equal(moved.type, "rectangle");
    if (moved.type !== "rectangle") return;
    assert.equal(moved.rect.x, 13);
    assert.equal(moved.rect.y, 19);
    assert.equal(moved.callout?.x, 25);
    assert.equal(moved.callout?.y, 25);
  });

  it("reports the box hull", () => {
    const bounds = annotationPdfBounds({
      type: "rectangle",
      rect: { x: 10, y: 20, width: 8, height: 6 },
      color: "#0ea5e9",
      strokeWidthPt: 2,
    });
    assert.deepEqual(bounds, { x: 10, y: 20, width: 8, height: 6 });
  });
});

describe("applyFollowedRiserOffsets", () => {
  it("nudges only the matching overlay box", () => {
    const overlays: FloorPlanAnnotation[] = [
      {
        type: "rectangle",
        rect: { x: 10, y: 20, width: 8, height: 6 },
        color: "#0ea5e9",
        strokeWidthPt: 2,
        callout: { x: 22, y: 26, text: "B11", riserId: "r1", riserIds: ["r1"] },
      },
      {
        type: "rectangle",
        rect: { x: 40, y: 20, width: 8, height: 6 },
        color: "#0ea5e9",
        strokeWidthPt: 2,
        callout: { x: 52, y: 26, text: "B12", riserId: "r2", riserIds: ["r2"] },
      },
    ];
    const next = applyFollowedRiserOffsets(overlays, "f12", [
      { planId: "f12", riserId: "r1", dx: 5, dy: 0 },
    ]);
    assert.equal(next[0]?.type, "rectangle");
    if (next[0]?.type !== "rectangle" || next[1]?.type !== "rectangle") return;
    assert.equal(next[0].rect.x, 15);
    assert.equal(next[1].rect.x, 40);
    assert.equal(overlayAnnotationsMatchingRisers(next, ["r1"]).length, 1);
  });
});

describe("box rotation", () => {
  it("snaps to 45-degree world increments", () => {
    assert.equal(snapAnnotationRotationDeg(0), 0);
    assert.equal(snapAnnotationRotationDeg(22), 0);
    assert.equal(snapAnnotationRotationDeg(23), 45);
    assert.equal(snapAnnotationRotationDeg(90), 90);
    assert.equal(snapAnnotationRotationDeg(180), 180);
    assert.equal(snapAnnotationRotationDeg(337), 315);
    assert.equal(snapAnnotationRotationDeg(350), 0);
  });

  it("adds the pointer delta and optionally snaps", () => {
    const center = { x: 0, y: 0 };
    const start = { x: 10, y: 0 };
    const current = { x: 0, y: 10 };
    assert.equal(
      rotationFromPointerDrag(start, current, center, 0, false),
      90,
    );
    assert.equal(
      rotationFromPointerDrag(start, current, center, 10, true),
      90,
    );
  });

  it("round-trips rotationDeg through parse", () => {
    const parsed = parseFloorPlanAnnotations([
      box(0, 0, { rotationDeg: 45 }),
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(annotationRotationDeg(parsed[0]!), 45);
    const omitted = parseFloorPlanAnnotations([box(0, 0, { rotationDeg: 0 })]);
    assert.equal(omitted[0] && "rotationDeg" in omitted[0], false);
  });

  it("copies rotation onto a placed ABV box", () => {
    const source = box(0, 0, { rotationDeg: 135 });
    const next = placeAndConnectRiserBox([source], source, { x: 40, y: 16 }, 0);
    assert.ok(next);
    if (next![0].type !== "rectangle" || next![1].type !== "rectangle") return;
    assert.equal(next![0].rotationDeg, 135);
    assert.equal(next![1].rotationDeg, 135);
  });

  it("hit-tests in the rotated frame", () => {
    const rotated = box(0, 0, { rotationDeg: 90 });
    const annotations = [rotated];
    assert.equal(
      hitTestConnectableBox({ x: 5, y: 4 }, annotations, 0),
      0,
    );
    assert.equal(
      hitTestConnectableBox({ x: 0, y: 0 }, annotations, 0),
      null,
    );
    assert.equal(
      hitTestConnectableBox({ x: 9, y: -1 }, annotations, 0.2),
      0,
    );
  });

  it("expands bounds to the rotated hull", () => {
    const bounds = annotationPdfBounds(box(0, 0, { rotationDeg: 90 }));
    assert.ok(bounds);
    assert.ok(Math.abs(bounds!.x - 1) < 0.01);
    assert.ok(Math.abs(bounds!.y - -1) < 0.01);
    assert.ok(Math.abs(bounds!.width - 8) < 0.01);
    assert.ok(Math.abs(bounds!.height - 10) < 0.01);
  });
});

describe("stampCalloutsFromMatchingOverlays", () => {
  it("copies the overlay callout onto an unlabeled matching box", () => {
    const unlabeled: FloorPlanAnnotation = {
      type: "rectangle",
      rect: { x: 10, y: 20, width: 8, height: 6 },
      color: "#94a3b8",
      strokeWidthPt: 2,
    };
    const overlay: FloorPlanAnnotation = {
      type: "rectangle",
      rect: { x: 10, y: 20, width: 8, height: 6 },
      color: "#0ea5e9",
      strokeWidthPt: 2,
      callout: {
        x: 22,
        y: 26,
        text: "Sanitary 11",
        riserId: "r1",
        riserIds: ["r1"],
      },
    };
    const stamped = stampCalloutsFromMatchingOverlays([unlabeled], [overlay]);
    assert.ok(stamped);
    assert.equal(stamped![0]?.callout?.riserId, "r1");
    assert.deepEqual(stamped![0]?.callout?.riserIds, ["r1"]);
    assert.equal(stamped![0]?.color, "#0ea5e9");
    assert.deepEqual(riserIdsAdoptedFromMatchingBoxes([unlabeled], [overlay]), [
      "r1",
    ]);
  });

  it("leaves already-tagged boxes unchanged", () => {
    const tagged: FloorPlanAnnotation = {
      type: "rectangle",
      rect: { x: 10, y: 20, width: 8, height: 6 },
      color: "#0ea5e9",
      strokeWidthPt: 2,
      callout: {
        x: 22,
        y: 26,
        text: "Sanitary 11",
        riserId: "r1",
        riserIds: ["r1"],
      },
    };
    assert.equal(stampCalloutsFromMatchingOverlays([tagged], [tagged]), null);
  });
});
