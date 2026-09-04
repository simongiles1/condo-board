/**
 * Floor-plan box callout tests.
 * Run: npx tsx --test scripts/test-floor-plan-callouts.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterAnnotationsByMarkupSet,
  mergeAnnotationsByMarkupSet,
  mapAnnotationsAcrossPlans,
  mapAnnotationsToCroppedPlate,
  parseFloorPlanAnnotations,
  type FloorPlanRectangleAnnotation,
} from "@/lib/building/floor-plan-annotations";
import {
  calloutBubbleSizePt,
  calloutLeaderEndpoints,
  defaultCallout,
  defaultCalloutPosition,
  duplicateCallout,
  hitTestCallout,
  translateCallout,
  wrapCalloutLines,
} from "@/lib/building/floor-plan-callouts";
import { stripRiserLink } from "@/lib/building/floor-plan-riser-links";

function box(
  extras: Partial<FloorPlanRectangleAnnotation> = {},
): FloorPlanRectangleAnnotation {
  return {
    type: "rectangle",
    rect: { x: 10, y: 20, width: 40, height: 24 },
    color: "#dc2626",
    strokeWidthPt: 2,
    ...extras,
  };
}

describe("wrapCalloutLines", () => {
  it("uses a placeholder for empty text", () => {
    assert.deepEqual(wrapCalloutLines("", 20), ["Label"]);
  });

  it("wraps long words and keeps explicit newlines", () => {
    const lines = wrapCalloutLines("one\ntwothreefourfive six", 8);
    assert.ok(lines.includes("one"));
    assert.ok(lines.length >= 3);
  });
});

describe("defaultCalloutPosition", () => {
  it("places the bubble outside the upper-right of the box", () => {
    const item = box();
    const point = defaultCalloutPosition(item, 18);
    assert.equal(point.x, 10 + 40 + 18);
    assert.equal(point.y, 20 + 24 + 18);
    assert.ok(point.x > item.rect.x + item.rect.width);
    assert.ok(point.y > item.rect.y + item.rect.height);
  });
});

describe("calloutLeaderEndpoints", () => {
  it("runs from the bubble edge to the box edge", () => {
    const item = box();
    const callout = defaultCallout(item);
    const bubble = { width: 20, height: 12 };
    const ends = calloutLeaderEndpoints(item, callout, bubble);
    assert.ok(ends);
    assert.ok(ends!.start.x >= callout.x - bubble.width / 2 - 0.01);
    assert.ok(ends!.start.x <= callout.x + bubble.width / 2 + 0.01);
    assert.ok(ends!.end.x <= item.rect.x + item.rect.width + 0.01);
    assert.ok(ends!.end.x >= item.rect.x - 0.01);
  });
});

describe("hitTestCallout", () => {
  it("hits the bubble and misses the box interior", () => {
    const item = box({ callout: { x: 80, y: 70, text: "AHU" } });
    const size = calloutBubbleSizePt("AHU", 1, 1);
    assert.equal(
      hitTestCallout({ x: 80, y: 70 }, [item], 1, 1),
      0,
    );
    assert.equal(
      hitTestCallout({ x: 20, y: 30 }, [item], 1, 1),
      null,
    );
    assert.ok(size.width > 0 && size.height > 0);
  });
});

describe("parseFloorPlanAnnotations callout", () => {
  it("round-trips callout text and position", () => {
    const parsed = parseFloorPlanAnnotations([
      box({ callout: { x: 90, y: 88, text: "Riser 4" } }),
    ]);
    assert.equal(parsed.length, 1);
    if (parsed[0].type !== "rectangle") return;
    assert.deepEqual(parsed[0].callout, { x: 90, y: 88, text: "Riser 4" });
  });

  it("round-trips a catalog riser id on a callout", () => {
    const parsed = parseFloorPlanAnnotations([
      box({
        callout: {
          x: 90,
          y: 88,
          text: "Sanitary 4",
          riserId: "riser-1",
        },
      }),
    ]);
    assert.equal(parsed.length, 1);
    if (parsed[0].type !== "rectangle") return;
    assert.deepEqual(parsed[0].callout, {
      x: 90,
      y: 88,
      text: "Sanitary 4",
      riserId: "riser-1",
    });
  });

  it("round-trips a pending catalog type id on a callout", () => {
    const parsed = parseFloorPlanAnnotations([
      box({
        callout: {
          x: 90,
          y: 88,
          text: "",
          typeId: "type-hc",
        },
      }),
    ]);
    assert.equal(parsed.length, 1);
    if (parsed[0].type !== "rectangle") return;
    assert.equal(parsed[0].callout?.typeId, "type-hc");
  });

  it("round-trips markup set 2 and defaults omitted to 1", () => {
    const parsed = parseFloorPlanAnnotations([
      box({ markupSet: 2 }),
      box(),
      {
        type: "polyline",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        color: "#16a34a",
        strokeWidthPt: 2,
        markupSet: 2,
      },
    ]);
    assert.equal(parsed[0]?.markupSet, 2);
    assert.equal(parsed[1]?.markupSet, undefined);
    assert.equal(parsed[2]?.markupSet, 2);
  });

  it("keeps the box when callout data is invalid", () => {
    const parsed = parseFloorPlanAnnotations([
      {
        type: "rectangle",
        rect: { x: 0, y: 0, width: 10, height: 8 },
        color: "#16a34a",
        strokeWidthPt: 2,
        callout: { x: "nope", text: 3 },
      },
    ]);
    assert.equal(parsed.length, 1);
    if (parsed[0].type !== "rectangle") return;
    assert.equal(parsed[0].callout, undefined);
  });
});

describe("stripRiserLink", () => {
  it("preserves a callout when riser fields are cleared", () => {
    const item = box({
      id: "a",
      riserPartnerId: "b",
      riserRole: "above",
      callout: { x: 12, y: 14, text: "Keep me" },
    });
    const stripped = stripRiserLink(item);
    assert.equal(stripped.riserRole, undefined);
    assert.deepEqual(stripped.callout, { x: 12, y: 14, text: "Keep me" });
  });

  it("preserves markup set 2", () => {
    const stripped = stripRiserLink(
      box({
        id: "a",
        riserPartnerId: "b",
        riserRole: "above",
        markupSet: 2,
      }),
    );
    assert.equal(stripped.markupSet, 2);
  });
});

describe("mergeAnnotationsByMarkupSet", () => {
  it("keeps the other pass when replacing the active pass", () => {
    const v1 = box({ color: "#dc2626" });
    const v2old = box({ color: "#0ea5e9", markupSet: 2 });
    const v2new = box({ color: "#16a34a" });
    const merged = mergeAnnotationsByMarkupSet([v1, v2old], [v2new], 2);
    assert.equal(merged.length, 2);
    assert.equal(filterAnnotationsByMarkupSet(merged, 1).length, 1);
    assert.equal(filterAnnotationsByMarkupSet(merged, 1)[0]?.color, "#dc2626");
    assert.equal(filterAnnotationsByMarkupSet(merged, 2).length, 1);
    assert.equal(filterAnnotationsByMarkupSet(merged, 2)[0]?.color, "#16a34a");
    assert.equal(filterAnnotationsByMarkupSet(merged, 2)[0]?.markupSet, 2);
  });

  it("leaving set 2 empty does not drop set 1", () => {
    const v1 = box();
    const merged = mergeAnnotationsByMarkupSet([v1], [], 2);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.markupSet, undefined);
  });
});

describe("mapAnnotationsAcrossPlans callout", () => {
  it("maps the callout point with the box", () => {
    const [mapped] = mapAnnotationsAcrossPlans(
      [
        box({
          rect: { x: 100, y: 180, width: 30, height: 20 },
          callout: { x: 145, y: 220, text: "Fan" },
        }),
      ],
      { x: 100, y: 200 },
      { x: 400, y: 500 },
      { scaleDenominator: 50 },
      { scaleDenominator: 150 },
    );
    assert.equal(mapped.type, "rectangle");
    if (mapped.type !== "rectangle") return;
    assert.ok(mapped.callout);
    assert.equal(mapped.callout!.text, "Fan");
    assert.equal(mapped.callout!.x, 415);
    assert.equal(mapped.callout!.y, 506.6666666666667);
  });
});

describe("mapAnnotationsToCroppedPlate callout", () => {
  it("subtracts the crop origin from the callout point", () => {
    const [mapped] = mapAnnotationsToCroppedPlate(
      [box({ callout: { x: 120, y: 220, text: "Pump" } })],
      { x: 100, y: 200 },
    );
    assert.equal(mapped.type, "rectangle");
    if (mapped.type !== "rectangle") return;
    assert.deepEqual(mapped.callout, { x: 20, y: 20, text: "Pump" });
  });
});

describe("duplicateCallout", () => {
  it("copies text and places the bubble at the target box default position", () => {
    const source = box();
    const target = box({ rect: { x: 100, y: 200, width: 40, height: 24 } });
    const next = duplicateCallout({ x: 80, y: 70, text: "Riser 4" }, target);
    const expected = defaultCalloutPosition(target);
    assert.equal(next.text, "Riser 4");
    assert.deepEqual({ x: next.x, y: next.y }, expected);
  });

  it("copies a pending catalog type id", () => {
    const target = box({ rect: { x: 100, y: 200, width: 40, height: 24 } });
    const next = duplicateCallout(
      { x: 80, y: 70, text: "", typeId: "type-hc" },
      target,
    );
    assert.equal(next.typeId, "type-hc");
  });
});

describe("translateCallout", () => {
  it("moves the bubble independently of the box", () => {
    const next = translateCallout({ x: 10, y: 20, text: "A" }, 5, -3);
    assert.deepEqual(next, { x: 15, y: 17, text: "A" });
  });
});
