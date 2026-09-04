/**
 * Mechanical riser standardization: define standardized templates (sizes, shapes,
 * multi-circle layouts) per riser type, and replace freehand rectangles with
 * standardized, centered shapes.
 */

import {
  type PdfPoint,
  type PdfRect,
} from "@/lib/building/floor-plan-align";
import {
  annotationRotationDeg,
  normalizeStrokeColor,
  pdfRectCenter,
  type FloorPlanAnnotation,
  type FloorPlanCircleAnnotation,
  type FloorPlanRectangleAnnotation,
  type ShapeCrossVariant,
} from "@/lib/building/floor-plan-annotations";
import {
  calloutRiserIds,
  type MechanicalRiserDto,
  type MechanicalRiserTypeDto,
} from "@/lib/building/floor-plan-mechanical-risers";

export type RiserTemplateShape = {
  id?: string;
  type: "circle" | "rectangle";
  /** Offset of shape center relative to the template collective center (PDF points). */
  offsetXPt: number;
  offsetYPt: number;
  /** Width / bounding box width in PDF points (diameter for circle). */
  widthPt: number;
  /** Height / bounding box height in PDF points (diameter for circle). */
  heightPt: number;
  variant?: ShapeCrossVariant;
  filled?: boolean;
  strokeWidthPt?: number;
  /** Primary shape that carries the original callout, riser id, and connection links. */
  primary?: boolean;
};

export type RiserTypeTemplate = {
  typeId: string;
  name?: string;
  shapes: RiserTemplateShape[];
  /** Overall bounding box width and height in PDF points. */
  totalWidthPt: number;
  totalHeightPt: number;
  /** If true, rotates 90° when target rectangle has opposing orientation (landscape vs portrait). */
  autoOrient?: boolean;
  updatedAt?: string;
};

/** Bounding box of template shapes using their current offset origin. */
export function computeTemplateBounds(shapes: RiserTemplateShape[]): {
  totalWidthPt: number;
  totalHeightPt: number;
} {
  if (shapes.length === 0) {
    return { totalWidthPt: 0, totalHeightPt: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const s of shapes) {
    const halfW = Math.max(0.1, s.widthPt) / 2;
    const halfH = Math.max(0.1, s.heightPt) / 2;
    minX = Math.min(minX, s.offsetXPt - halfW);
    maxX = Math.max(maxX, s.offsetXPt + halfW);
    minY = Math.min(minY, s.offsetYPt - halfH);
    maxY = Math.max(maxY, s.offsetYPt + halfH);
  }

  return {
    totalWidthPt: Number(Math.max(1, maxX - minX).toFixed(3)),
    totalHeightPt: Number(Math.max(1, maxY - minY).toFixed(3)),
  };
}

/**
 * Normalizes template shapes so that (0, 0) is the exact center of their
 * collective bounding box, and computes overall total width/height.
 */
export function normalizeTemplateShapes(
  shapes: RiserTemplateShape[],
): {
  shapes: RiserTemplateShape[];
  totalWidthPt: number;
  totalHeightPt: number;
} {
  if (shapes.length === 0) {
    return { shapes: [], totalWidthPt: 0, totalHeightPt: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const s of shapes) {
    const halfW = Math.max(0.1, s.widthPt) / 2;
    const halfH = Math.max(0.1, s.heightPt) / 2;
    minX = Math.min(minX, s.offsetXPt - halfW);
    maxX = Math.max(maxX, s.offsetXPt + halfW);
    minY = Math.min(minY, s.offsetYPt - halfH);
    maxY = Math.max(maxY, s.offsetYPt + halfH);
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const { totalWidthPt, totalHeightPt } = computeTemplateBounds(shapes);

  const hasPrimary = shapes.some((s) => s.primary);

  const normalized = shapes.map((s, index) => {
    const isPrimary = hasPrimary ? Boolean(s.primary) : index === 0;
    return {
      ...s,
      offsetXPt: Number((s.offsetXPt - cx).toFixed(3)),
      offsetYPt: Number((s.offsetYPt - cy).toFixed(3)),
      widthPt: Number(s.widthPt.toFixed(3)),
      heightPt: Number(s.heightPt.toFixed(3)),
      primary: isPrimary,
    };
  });

  return {
    shapes: normalized,
    totalWidthPt: Number(totalWidthPt.toFixed(3)),
    totalHeightPt: Number(totalHeightPt.toFixed(3)),
  };
}

/**
 * Creates a template from an array of floor plan annotations (e.g. 3 circles
 * drawn over a toilet riser group).
 */
export function createTemplateFromAnnotations(
  typeId: string,
  annotations: (FloorPlanRectangleAnnotation | FloorPlanCircleAnnotation)[],
  options?: {
    primaryIndex?: number;
    autoOrient?: boolean;
    name?: string;
  },
): RiserTypeTemplate {
  if (annotations.length === 0) {
    return {
      typeId,
      name: options?.name,
      shapes: [],
      totalWidthPt: 0,
      totalHeightPt: 0,
      autoOrient: options?.autoOrient ?? true,
      updatedAt: new Date().toISOString(),
    };
  }

  // Calculate the collective bounding box center of all annotations
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const item of annotations) {
    minX = Math.min(minX, item.rect.x);
    maxX = Math.max(maxX, item.rect.x + item.rect.width);
    minY = Math.min(minY, item.rect.y);
    maxY = Math.max(maxY, item.rect.y + item.rect.height);
  }

  const groupCenterX = (minX + maxX) / 2;
  const groupCenterY = (minY + maxY) / 2;

  const rawShapes: RiserTemplateShape[] = annotations.map((item, index) => {
    const itemCenter = pdfRectCenter(item.rect);
    const offsetXPt = itemCenter.x - groupCenterX;
    const offsetYPt = itemCenter.y - groupCenterY;
    const isPrimary =
      options?.primaryIndex != null
        ? index === options.primaryIndex
        : index === 0;

    const shape: RiserTemplateShape = {
      type: item.type,
      offsetXPt,
      offsetYPt,
      widthPt: item.rect.width,
      heightPt: item.rect.height,
      variant: item.variant === "cross" ? "cross" : "plain",
      filled: item.filled === true,
      strokeWidthPt: item.strokeWidthPt,
      primary: isPrimary,
    };
    return shape;
  });

  const { shapes, totalWidthPt, totalHeightPt } = normalizeTemplateShapes(rawShapes);

  return {
    typeId,
    name: options?.name,
    shapes,
    totalWidthPt,
    totalHeightPt,
    autoOrient: options?.autoOrient ?? true,
    updatedAt: new Date().toISOString(),
  };
}

/** Blank template — user adds circles/rectangles or loads a preset. */
export function createEmptyTemplate(
  typeId: string,
  options?: {
    autoOrient?: boolean;
    name?: string;
  },
): RiserTypeTemplate {
  return {
    typeId,
    name: options?.name,
    shapes: [],
    totalWidthPt: 0,
    totalHeightPt: 0,
    autoOrient: options?.autoOrient ?? true,
    updatedAt: new Date().toISOString(),
  };
}

function pdfRectIntersectionArea(a: PdfRect, b: PdfRect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

/**
 * Pick the freehand riser rectangle that best matches a user-drawn clip region.
 * Falls back to index 0 when nothing overlaps.
 */
export function findSampleRiserIndexInClip(
  matches: { annotation: FloorPlanRectangleAnnotation }[],
  clip: PdfRect,
): number {
  if (matches.length === 0) return 0;

  const clipCenter = pdfRectCenter(clip);
  let bestIdx = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < matches.length; i++) {
    const rect = matches[i]!.annotation.rect;
    const center = pdfRectCenter(rect);
    const insideClip =
      center.x >= clip.x &&
      center.x <= clip.x + clip.width &&
      center.y >= clip.y &&
      center.y <= clip.y + clip.height;
    const overlap = pdfRectIntersectionArea(rect, clip);
    const dist = Math.hypot(center.x - clipCenter.x, center.y - clipCenter.y);
    const score = (insideClip ? 1_000_000 : 0) + overlap * 100 - dist;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/** Minimum box size when drag-drawing template shapes (matches main canvas). */
export const MIN_TEMPLATE_BOX_PT = 0.5;

/**
 * Build one template shape from a drag-drawn PDF bounding box, relative to the
 * sample riser center (or clip center when no reference is available).
 */
export function templateShapeFromPdfRect(
  rect: PdfRect,
  type: "circle" | "rectangle",
  referenceCenter: PdfPoint,
  options?: {
    variant?: ShapeCrossVariant;
    filled?: boolean;
    strokeWidthPt?: number;
    primary?: boolean;
  },
): RiserTemplateShape {
  const center = pdfRectCenter(rect);
  return {
    type,
    offsetXPt: Number((center.x - referenceCenter.x).toFixed(3)),
    offsetYPt: Number((referenceCenter.y - center.y).toFixed(3)),
    widthPt: Number(rect.width.toFixed(3)),
    heightPt: Number(rect.height.toFixed(3)),
    variant: options?.variant === "cross" ? "cross" : "plain",
    filled: options?.filled === true,
    strokeWidthPt: options?.strokeWidthPt,
    primary: options?.primary === true,
  };
}

/**
 * Creates a single standardized rectangle template.
 */
export function createRectangleTemplate(
  typeId: string,
  widthPt: number,
  heightPt: number,
  options?: {
    variant?: ShapeCrossVariant;
    strokeWidthPt?: number;
    autoOrient?: boolean;
    name?: string;
  },
): RiserTypeTemplate {
  const shape: RiserTemplateShape = {
    type: "rectangle",
    offsetXPt: 0,
    offsetYPt: 0,
    widthPt: Math.max(1, widthPt),
    heightPt: Math.max(1, heightPt),
    variant: options?.variant === "cross" ? "cross" : "plain",
    strokeWidthPt: options?.strokeWidthPt,
    primary: true,
  };

  return {
    typeId,
    name: options?.name,
    shapes: [shape],
    totalWidthPt: shape.widthPt,
    totalHeightPt: shape.heightPt,
    autoOrient: options?.autoOrient ?? true,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Creates a single standardized circle template.
 */
export function createCircleTemplate(
  typeId: string,
  diameterPt: number,
  options?: {
    variant?: ShapeCrossVariant;
    filled?: boolean;
    strokeWidthPt?: number;
    name?: string;
  },
): RiserTypeTemplate {
  const d = Math.max(1, diameterPt);
  const shape: RiserTemplateShape = {
    type: "circle",
    offsetXPt: 0,
    offsetYPt: 0,
    widthPt: d,
    heightPt: d,
    variant: options?.variant === "cross" ? "cross" : "plain",
    filled: options?.filled === true,
    strokeWidthPt: options?.strokeWidthPt,
    primary: true,
  };

  return {
    typeId,
    name: options?.name,
    shapes: [shape],
    totalWidthPt: d,
    totalHeightPt: d,
    autoOrient: false,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Checks whether an annotation belongs to a mechanical riser type.
 * Matches by callout.typeId, callout.riserId -> riser.typeId, or normalized stroke color.
 */
export function isAnnotationOfRiserType(
  item: FloorPlanAnnotation,
  type: MechanicalRiserTypeDto,
  risers: MechanicalRiserDto[],
): boolean {
  if (item.type !== "rectangle" && item.type !== "circle") return false;

  // 1. Direct callout typeId
  if (item.callout?.typeId && item.callout.typeId === type.id) {
    return true;
  }

  // 2. Callout riserIds
  if (item.callout) {
    const ids = calloutRiserIds(item.callout);
    if (ids.length > 0) {
      const match = ids.some((id) => {
        const found = risers.find((r) => r.id === id);
        return found?.typeId === type.id;
      });
      if (match) return true;
    }
  }

  // 3. Normalized stroke color
  if (
    type.color &&
    item.color &&
    normalizeStrokeColor(item.color) === normalizeStrokeColor(type.color)
  ) {
    return true;
  }

  return false;
}

/**
 * Finds all rectangle annotations matching a given riser type.
 */
export function findMatchingRiserRectangles(
  annotations: FloorPlanAnnotation[],
  type: MechanicalRiserTypeDto,
  risers: MechanicalRiserDto[],
): { index: number; annotation: FloorPlanRectangleAnnotation }[] {
  const matches: { index: number; annotation: FloorPlanRectangleAnnotation }[] = [];
  for (let i = 0; i < annotations.length; i++) {
    const item = annotations[i]!;
    if (item.type === "rectangle" && isAnnotationOfRiserType(item, type, risers)) {
      matches.push({ index: i, annotation: item });
    }
  }
  return matches;
}

/**
 * Applies a standardized template to a single target rectangle,
 * centering the template shapes inside the rectangle and preserving
 * links, callouts, and rotation.
 */
export function applyTemplateToRectangle(
  target: FloorPlanRectangleAnnotation,
  template: RiserTypeTemplate,
  options?: {
    autoOrient?: boolean;
    color?: string;
  },
): (FloorPlanRectangleAnnotation | FloorPlanCircleAnnotation)[] {
  if (template.shapes.length === 0) return [target];

  const targetCenter = pdfRectCenter(target.rect);
  const targetRotationDeg = annotationRotationDeg(target);
  const shouldAutoOrient = options?.autoOrient ?? template.autoOrient ?? true;

  // Determine if aspect orientation is inverted (e.g. target is landscape, template is portrait)
  const targetIsLandscape = target.rect.width > target.rect.height;
  const templateIsLandscape = template.totalWidthPt > template.totalHeightPt;
  const needs90Rotation =
    shouldAutoOrient &&
    template.shapes.length > 1 &&
    targetIsLandscape !== templateIsLandscape;

  const totalRotationDeg =
    (targetRotationDeg + (needs90Rotation ? 90 : 0)) % 360;
  const rad = (totalRotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const strokeColor = options?.color || target.color;
  const primaryShapeIndex = template.shapes.findIndex((s) => s.primary);
  const effectivePrimaryIndex =
    primaryShapeIndex >= 0 ? primaryShapeIndex : 0;

  return template.shapes.map((shape, index) => {
    // Rotate relative offset around (0, 0)
    const rx = shape.offsetXPt * cos - shape.offsetYPt * sin;
    const ry = shape.offsetXPt * sin + shape.offsetYPt * cos;

    const shapeCenterX = targetCenter.x + rx;
    const shapeCenterY = targetCenter.y + ry;

    const halfW = shape.widthPt / 2;
    const halfH = shape.heightPt / 2;
    const rect: PdfRect = {
      x: Number((shapeCenterX - halfW).toFixed(3)),
      y: Number((shapeCenterY - halfH).toFixed(3)),
      width: shape.widthPt,
      height: shape.heightPt,
    };

    const isPrimary = index === effectivePrimaryIndex;

    const base: FloorPlanRectangleAnnotation | FloorPlanCircleAnnotation =
      shape.type === "circle"
        ? {
            type: "circle",
            rect,
            color: strokeColor,
            strokeWidthPt: shape.strokeWidthPt ?? target.strokeWidthPt,
            ...(shape.variant === "cross" ? { variant: "cross" } : {}),
            ...(shape.filled ? { filled: true } : {}),
            ...(totalRotationDeg !== 0 ? { rotationDeg: totalRotationDeg } : {}),
            ...(target.markupSet ? { markupSet: target.markupSet } : {}),
          }
        : {
            type: "rectangle",
            rect,
            color: strokeColor,
            strokeWidthPt: shape.strokeWidthPt ?? target.strokeWidthPt,
            ...(shape.variant === "cross" ? { variant: "cross" } : {}),
            ...(shape.filled ? { filled: true } : {}),
            ...(totalRotationDeg !== 0 ? { rotationDeg: totalRotationDeg } : {}),
            ...(target.markupSet ? { markupSet: target.markupSet } : {}),
          };

    // Attach callout, riser id, and links to the primary shape
    if (isPrimary) {
      if (target.id) base.id = target.id;
      if (target.riserRole) base.riserRole = target.riserRole;
      if (target.riserPartnerId) base.riserPartnerId = target.riserPartnerId;
      if (target.riserPartnerIds) base.riserPartnerIds = [...target.riserPartnerIds];
      if (target.callout) {
        base.callout = {
          ...target.callout,
          riserIds: target.callout.riserIds ? [...target.callout.riserIds] : undefined,
        };
      }
    }

    return base;
  });
}

/**
 * Standardizes all matching rectangles of a given riser type within an
 * annotation set, replacing them with centered template shape(s).
 */
export function standardizeFloorPlanAnnotations(
  annotations: FloorPlanAnnotation[],
  type: MechanicalRiserTypeDto,
  template: RiserTypeTemplate,
  risers: MechanicalRiserDto[],
  options?: {
    autoOrient?: boolean;
    color?: string;
  },
): {
  annotations: FloorPlanAnnotation[];
  replacedCount: number;
} {
  if (template.shapes.length === 0) {
    return { annotations, replacedCount: 0 };
  }

  let replacedCount = 0;
  const result: FloorPlanAnnotation[] = [];

  for (const item of annotations) {
    if (item.type === "rectangle" && isAnnotationOfRiserType(item, type, risers)) {
      const replacements = applyTemplateToRectangle(item, template, options);
      result.push(...replacements);
      replacedCount++;
    } else {
      result.push(item);
    }
  }

  return {
    annotations: result,
    replacedCount,
  };
}

/**
 * Parses the riser templates dictionary stored in JSON.
 */
export function parseRiserTemplates(
  raw: unknown,
): Record<string, RiserTypeTemplate> {
  if (!raw) return {};
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const result: Record<string, RiserTypeTemplate> = {};
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const candidate = val as Partial<RiserTypeTemplate>;
    if (typeof candidate.typeId !== "string" || !Array.isArray(candidate.shapes)) {
      continue;
    }
    const shapes: RiserTemplateShape[] = [];
    for (const s of candidate.shapes) {
      if (
        s &&
        typeof s === "object" &&
        (s.type === "circle" || s.type === "rectangle") &&
        typeof s.offsetXPt === "number" &&
        typeof s.offsetYPt === "number" &&
        typeof s.widthPt === "number" &&
        typeof s.heightPt === "number"
      ) {
        shapes.push({
          id: typeof s.id === "string" ? s.id : undefined,
          type: s.type,
          offsetXPt: s.offsetXPt,
          offsetYPt: s.offsetYPt,
          widthPt: s.widthPt,
          heightPt: s.heightPt,
          variant: s.variant === "cross" ? "cross" : "plain",
          filled: Boolean(s.filled),
          strokeWidthPt: typeof s.strokeWidthPt === "number" ? s.strokeWidthPt : undefined,
          primary: Boolean(s.primary),
        });
      }
    }

    result[key] = {
      typeId: candidate.typeId,
      name: typeof candidate.name === "string" ? candidate.name : undefined,
      shapes,
      totalWidthPt: typeof candidate.totalWidthPt === "number" ? candidate.totalWidthPt : 0,
      totalHeightPt: typeof candidate.totalHeightPt === "number" ? candidate.totalHeightPt : 0,
      autoOrient: candidate.autoOrient !== false,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : undefined,
    };
  }

  return result;
}

/**
 * Serializes the riser templates dictionary to a JSON string.
 */
export function serializeRiserTemplates(
  templates: Record<string, RiserTypeTemplate>,
): string {
  return JSON.stringify(templates);
}
