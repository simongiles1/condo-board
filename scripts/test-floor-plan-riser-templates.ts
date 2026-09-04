/**
 * Tests for mechanical riser template standardization.
 * Run: npx tsx --test scripts/test-floor-plan-riser-templates.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  FloorPlanCircleAnnotation,
  FloorPlanRectangleAnnotation,
} from "@/lib/building/floor-plan-annotations";
import {
  applyTemplateToRectangle,
  createCircleTemplate,
  createEmptyTemplate,
  createRectangleTemplate,
  createTemplateFromAnnotations,
  findSampleRiserIndexInClip,
  templateShapeFromPdfRect,
  isAnnotationOfRiserType,
  normalizeTemplateShapes,
  parseRiserTemplates,
  serializeRiserTemplates,
  standardizeFloorPlanAnnotations,
  type RiserTemplateShape,
  type RiserTypeTemplate,
} from "@/lib/building/floor-plan-riser-templates";
import type {
  MechanicalRiserDto,
  MechanicalRiserTypeDto,
} from "@/lib/building/floor-plan-mechanical-risers";

describe("templateShapeFromPdfRect", () => {
  it("offsets shape center from the reference riser center", () => {
    const reference = { x: 110, y: 220 };
    const shape = templateShapeFromPdfRect(
      { x: 106, y: 216, width: 8, height: 8 },
      "circle",
      reference,
      { strokeWidthPt: 3, primary: true },
    );
    assert.equal(shape.type, "circle");
    assert.equal(shape.offsetXPt, 0);
    assert.equal(shape.offsetYPt, 0);
    assert.equal(shape.widthPt, 8);
    assert.equal(shape.strokeWidthPt, 3);
    assert.equal(shape.primary, true);
  });
});

describe("findSampleRiserIndexInClip", () => {
  it("prefers the riser whose center falls inside the clip", () => {
    const matches = [
      {
        annotation: {
          type: "rectangle" as const,
          rect: { x: 10, y: 10, width: 20, height: 20 },
          color: "#f18cf2",
          strokeWidthPt: 3,
        },
      },
      {
        annotation: {
          type: "rectangle" as const,
          rect: { x: 500, y: 500, width: 20, height: 20 },
          color: "#f18cf2",
          strokeWidthPt: 3,
        },
      },
    ];
    const clip = { x: 5, y: 5, width: 40, height: 40 };
    assert.equal(findSampleRiserIndexInClip(matches, clip), 0);
  });

  it("falls back to closest overlap when no center is inside the clip", () => {
    const matches = [
      {
        annotation: {
          type: "rectangle" as const,
          rect: { x: 100, y: 100, width: 20, height: 20 },
          color: "#f18cf2",
          strokeWidthPt: 3,
        },
      },
      {
        annotation: {
          type: "rectangle" as const,
          rect: { x: 200, y: 200, width: 20, height: 20 },
          color: "#f18cf2",
          strokeWidthPt: 3,
        },
      },
    ];
    const clip = { x: 95, y: 95, width: 30, height: 30 };
    assert.equal(findSampleRiserIndexInClip(matches, clip), 0);
  });
});

describe("createEmptyTemplate", () => {
  it("starts with no shapes", () => {
    const t = createEmptyTemplate("type-toilet");
    assert.equal(t.shapes.length, 0);
    assert.equal(t.totalWidthPt, 0);
    assert.equal(t.totalHeightPt, 0);
  });
});

describe("normalizeTemplateShapes", () => {
  it("centers 3 vertically aligned circles around (0, 0)", () => {
    // 3 circles of diameter 10, spaced along Y
    const input: RiserTemplateShape[] = [
      { type: "circle", offsetXPt: 50, offsetYPt: 100, widthPt: 10, heightPt: 10, variant: "cross" },
      { type: "circle", offsetXPt: 50, offsetYPt: 85, widthPt: 10, heightPt: 10, filled: true },
      { type: "circle", offsetXPt: 50, offsetYPt: 70, widthPt: 10, heightPt: 10, filled: true },
    ];

    const { shapes, totalWidthPt, totalHeightPt } = normalizeTemplateShapes(input);

    assert.equal(shapes.length, 3);
    assert.equal(totalWidthPt, 10);
    assert.equal(totalHeightPt, 40); // from (70-5) to (100+5) = 65 to 105 = 40

    // Center was at X=50, Y=85.
    assert.equal(shapes[0]!.offsetXPt, 0);
    assert.equal(shapes[0]!.offsetYPt, 15);
    assert.equal(shapes[0]!.variant, "cross");

    assert.equal(shapes[1]!.offsetXPt, 0);
    assert.equal(shapes[1]!.offsetYPt, 0);
    assert.equal(shapes[1]!.filled, true);

    assert.equal(shapes[2]!.offsetXPt, 0);
    assert.equal(shapes[2]!.offsetYPt, -15);
    assert.equal(shapes[2]!.filled, true);

    // Primary assigned to first shape
    assert.equal(shapes[0]!.primary, true);
    assert.equal(shapes[1]!.primary, false);
  });
});

describe("createTemplateFromAnnotations", () => {
  it("creates template from drawn circles", () => {
    const circles: FloorPlanCircleAnnotation[] = [
      {
        type: "circle",
        rect: { x: 100, y: 200, width: 8, height: 8 },
        color: "#f18cf2",
        strokeWidthPt: 2,
        variant: "cross",
      },
      {
        type: "circle",
        rect: { x: 100, y: 185, width: 8, height: 8 },
        color: "#f18cf2",
        strokeWidthPt: 2,
        filled: true,
      },
      {
        type: "circle",
        rect: { x: 100, y: 170, width: 8, height: 8 },
        color: "#f18cf2",
        strokeWidthPt: 2,
        filled: true,
      },
    ];

    const template = createTemplateFromAnnotations("type-toilet", circles, {
      name: "Toilet 3-pipe cluster",
    });

    assert.equal(template.typeId, "type-toilet");
    assert.equal(template.name, "Toilet 3-pipe cluster");
    assert.equal(template.shapes.length, 3);
    assert.equal(template.shapes[0]!.type, "circle");
    assert.equal(template.shapes[0]!.variant, "cross");
    assert.equal(template.shapes[1]!.filled, true);
    assert.equal(template.shapes[2]!.filled, true);
  });
});

describe("createRectangleTemplate & createCircleTemplate", () => {
  it("creates a standardized rectangle template", () => {
    const t = createRectangleTemplate("type-elec", 30, 15, { variant: "cross" });
    assert.equal(t.shapes.length, 1);
    assert.equal(t.shapes[0]!.type, "rectangle");
    assert.equal(t.shapes[0]!.widthPt, 30);
    assert.equal(t.shapes[0]!.heightPt, 15);
    assert.equal(t.shapes[0]!.variant, "cross");
    assert.equal(t.shapes[0]!.offsetXPt, 0);
    assert.equal(t.shapes[0]!.offsetYPt, 0);
  });

  it("creates a standardized circle template", () => {
    const t = createCircleTemplate("type-storm", 12, { filled: true });
    assert.equal(t.shapes.length, 1);
    assert.equal(t.shapes[0]!.type, "circle");
    assert.equal(t.shapes[0]!.widthPt, 12);
    assert.equal(t.shapes[0]!.filled, true);
  });
});

describe("isAnnotationOfRiserType", () => {
  const toiletType: MechanicalRiserTypeDto = {
    id: "type-toilet",
    name: "Riser - Toilet",
    color: "#f18cf2",
    sortOrder: 0,
  };

  const risers: MechanicalRiserDto[] = [
    { id: "riser-1", typeId: "type-toilet", label: "T1" },
  ];

  it("matches by stroke color", () => {
    const rect: FloorPlanRectangleAnnotation = {
      type: "rectangle",
      rect: { x: 10, y: 10, width: 20, height: 10 },
      color: "#F18CF2", // case-insensitive check
      strokeWidthPt: 3,
    };
    assert.equal(isAnnotationOfRiserType(rect, toiletType, risers), true);
  });

  it("matches by callout typeId", () => {
    const rect: FloorPlanRectangleAnnotation = {
      type: "rectangle",
      rect: { x: 10, y: 10, width: 20, height: 10 },
      color: "#000000",
      strokeWidthPt: 3,
      callout: { x: 10, y: 10, text: "", typeId: "type-toilet" },
    };
    assert.equal(isAnnotationOfRiserType(rect, toiletType, risers), true);
  });

  it("matches by callout riserId", () => {
    const rect: FloorPlanRectangleAnnotation = {
      type: "rectangle",
      rect: { x: 10, y: 10, width: 20, height: 10 },
      color: "#000000",
      strokeWidthPt: 3,
      callout: { x: 10, y: 10, text: "", riserId: "riser-1" },
    };
    assert.equal(isAnnotationOfRiserType(rect, toiletType, risers), true);
  });

  it("rejects non-matching annotations", () => {
    const rect: FloorPlanRectangleAnnotation = {
      type: "rectangle",
      rect: { x: 10, y: 10, width: 20, height: 10 },
      color: "#f03d8a", // Kitchen color
      strokeWidthPt: 3,
    };
    assert.equal(isAnnotationOfRiserType(rect, toiletType, risers), false);
  });
});

describe("applyTemplateToRectangle", () => {
  it("centers 3 circles inside the target rectangle and transfers callout & riser links", () => {
    const target: FloorPlanRectangleAnnotation = {
      type: "rectangle",
      rect: { x: 100, y: 200, width: 20, height: 40 },
      color: "#f18cf2",
      strokeWidthPt: 3,
      id: "box-123",
      riserRole: "above",
      riserPartnerId: "box-456",
      callout: { x: 130, y: 250, text: "ST:B-47", typeId: "type-toilet" },
    };

    // Target center is (110, 220)
    const template: RiserTypeTemplate = {
      typeId: "type-toilet",
      totalWidthPt: 8,
      totalHeightPt: 30,
      autoOrient: true,
      shapes: [
        { type: "circle", offsetXPt: 0, offsetYPt: 10, widthPt: 8, heightPt: 8, variant: "cross", primary: true },
        { type: "circle", offsetXPt: 0, offsetYPt: 0, widthPt: 8, heightPt: 8, filled: true },
        { type: "circle", offsetXPt: 0, offsetYPt: -10, widthPt: 8, heightPt: 8, filled: true },
      ],
    };

    const result = applyTemplateToRectangle(target, template);
    assert.equal(result.length, 3);

    // Top circle: center (110, 230), rect.x = 110 - 4 = 106, rect.y = 230 - 4 = 226
    assert.equal(result[0]!.type, "circle");
    assert.equal(result[0]!.rect.x, 106);
    assert.equal(result[0]!.rect.y, 226);
    assert.equal(result[0]!.variant, "cross");
    assert.equal(result[0]!.id, "box-123");
    assert.equal(result[0]!.riserRole, "above");
    assert.equal(result[0]!.riserPartnerId, "box-456");
    assert.equal(result[0]!.callout?.text, "ST:B-47");

    // Middle circle: center (110, 220), rect.x = 106, rect.y = 216
    assert.equal(result[1]!.type, "circle");
    assert.equal(result[1]!.rect.x, 106);
    assert.equal(result[1]!.rect.y, 216);
    assert.equal(result[1]!.filled, true);
    assert.equal(result[1]!.id, undefined); // Only primary inherits id

    // Bottom circle: center (110, 210), rect.x = 106, rect.y = 206
    assert.equal(result[2]!.type, "circle");
    assert.equal(result[2]!.rect.x, 106);
    assert.equal(result[2]!.rect.y, 206);
    assert.equal(result[2]!.filled, true);
  });

  it("auto-orients 90° when target rectangle is landscape and template is portrait", () => {
    // Landscape target: width=40, height=20 (center: 120, 210)
    const target: FloorPlanRectangleAnnotation = {
      type: "rectangle",
      rect: { x: 100, y: 200, width: 40, height: 20 },
      color: "#f18cf2",
      strokeWidthPt: 3,
    };

    // Portrait template: totalWidth=8, totalHeight=30
    const template: RiserTypeTemplate = {
      typeId: "type-toilet",
      totalWidthPt: 8,
      totalHeightPt: 30,
      autoOrient: true,
      shapes: [
        { type: "circle", offsetXPt: 0, offsetYPt: 10, widthPt: 8, heightPt: 8 },
        { type: "circle", offsetXPt: 0, offsetYPt: 0, widthPt: 8, heightPt: 8 },
        { type: "circle", offsetXPt: 0, offsetYPt: -10, widthPt: 8, heightPt: 8 },
      ],
    };

    const result = applyTemplateToRectangle(target, template);
    assert.equal(result.length, 3);

    // Rotated 90°: Y-offsets become X-offsets
    // Point (0, 10) rotated 90° CCW -> (-10, 0)
    // Centers should be spread horizontally along X around 120
    const xs = result.map((r) => r.rect.x + r.rect.width / 2);
    const ys = result.map((r) => r.rect.y + r.rect.height / 2);

    // Y values should all be 210
    assert.equal(ys[0], 210);
    assert.equal(ys[1], 210);
    assert.equal(ys[2], 210);

    // X values should differ by 10
    assert.equal(xs[1], 120);
    assert.ok(Math.abs(xs[0]! - 120) >= 9.9);
  });
});

describe("standardizeFloorPlanAnnotations", () => {
  it("replaces matching rectangles and keeps other annotations intact", () => {
    const toiletType: MechanicalRiserTypeDto = {
      id: "type-toilet",
      name: "Riser - Toilet",
      color: "#f18cf2",
      sortOrder: 0,
    };

    const template: RiserTypeTemplate = {
      typeId: "type-toilet",
      totalWidthPt: 6,
      totalHeightPt: 18,
      shapes: [
        { type: "circle", offsetXPt: 0, offsetYPt: 6, widthPt: 6, heightPt: 6 },
        { type: "circle", offsetXPt: 0, offsetYPt: -6, widthPt: 6, heightPt: 6 },
      ],
    };

    const annotations = [
      // Wall polyline
      {
        type: "polyline" as const,
        points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
        color: "#000000",
        strokeWidthPt: 2,
      },
      // Toilet rect 1
      {
        type: "rectangle" as const,
        rect: { x: 100, y: 100, width: 25, height: 12 },
        color: "#f18cf2",
        strokeWidthPt: 3,
      },
      // Kitchen rect
      {
        type: "rectangle" as const,
        rect: { x: 200, y: 200, width: 30, height: 15 },
        color: "#f03d8a",
        strokeWidthPt: 3,
      },
      // Toilet rect 2
      {
        type: "rectangle" as const,
        rect: { x: 300, y: 300, width: 24, height: 13 },
        color: "#f18cf2",
        strokeWidthPt: 3,
      },
    ];

    const { annotations: next, replacedCount } = standardizeFloorPlanAnnotations(
      annotations,
      toiletType,
      template,
      [],
    );

    assert.equal(replacedCount, 2);
    // 1 polyline + (2 * 2 circles) + 1 kitchen rect = 6
    assert.equal(next.length, 6);
    assert.equal(next[0]!.type, "polyline");
    assert.equal(next[1]!.type, "circle");
    assert.equal(next[2]!.type, "circle");
    assert.equal(next[3]!.type, "rectangle");
    assert.equal(next[3]!.color, "#f03d8a"); // Kitchen unchanged
    assert.equal(next[4]!.type, "circle");
    assert.equal(next[5]!.type, "circle");
  });
});

describe("parseRiserTemplates & serializeRiserTemplates", () => {
  it("serializes and deserializes cleanly", () => {
    const templates: Record<string, RiserTypeTemplate> = {
      "type-toilet": {
        typeId: "type-toilet",
        name: "Toilet Template",
        totalWidthPt: 10,
        totalHeightPt: 30,
        autoOrient: true,
        shapes: [
          { type: "circle", offsetXPt: 0, offsetYPt: 10, widthPt: 10, heightPt: 10, variant: "cross", primary: true },
          { type: "circle", offsetXPt: 0, offsetYPt: 0, widthPt: 10, heightPt: 10, filled: true },
        ],
      },
    };

    const json = serializeRiserTemplates(templates);
    const parsed = parseRiserTemplates(json);

    assert.deepEqual(parsed["type-toilet"]?.shapes.length, 2);
    assert.equal(parsed["type-toilet"]?.shapes[0]?.variant, "cross");
    assert.equal(parsed["type-toilet"]?.shapes[1]?.filled, true);
    assert.equal(parsed["type-toilet"]?.name, "Toilet Template");
  });

  it("handles empty / null input gracefully", () => {
    assert.deepEqual(parseRiserTemplates(null), {});
    assert.deepEqual(parseRiserTemplates(""), {});
    assert.deepEqual(parseRiserTemplates("not-json"), {});
  });
});
