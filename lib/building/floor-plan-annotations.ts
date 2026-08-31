/** Markup shapes drawn on floor-plan PDFs. Coordinates are PDF points (origin bottom-left). */

import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import type { SnapKind, SnapSegment } from "@/lib/building/floor-plan-draw-snap";

export type DrawTool =
  | "none"
  | "line"
  | "rectangle"
  | "circle"
  | "cut"
  | "connect";

/** Which end of a riser-offset pair continues to the floor above. */
export type RiserRole = "above" | "below";

type BoxRiserFields = {
  /** Assigned when the box is linked as a riser offset pair. */
  id?: string;
  riserPartnerId?: string;
  riserRole?: RiserRole;
};

/** Plain outline, or outline with bounding-box diagonals (X). */
export type ShapeCrossVariant = "plain" | "cross";

/** @deprecated Use {@link ShapeCrossVariant}. */
export type RectangleVariant = ShapeCrossVariant;

export type CircleVariant = ShapeCrossVariant;

export type FloorPlanPolylineAnnotation = {
  type: "polyline";
  points: PdfPoint[];
  color: string;
  strokeWidthPt: number;
};

export type FloorPlanRectangleAnnotation = {
  type: "rectangle";
  rect: PdfRect;
  /** Omitted or `"plain"` — four sides only; `"cross"` adds both diagonals. */
  variant?: ShapeCrossVariant;
  color: string;
  strokeWidthPt: number;
} & BoxRiserFields;

export type FloorPlanCircleAnnotation = {
  type: "circle";
  /** Axis-aligned bounding box (ellipse inscribed). */
  rect: PdfRect;
  /** Omitted or `"plain"` — ellipse only; `"cross"` adds both diagonals. */
  variant?: ShapeCrossVariant;
  color: string;
  strokeWidthPt: number;
} & BoxRiserFields;

export type FloorPlanAnnotation =
  | FloorPlanPolylineAnnotation
  | FloorPlanRectangleAnnotation
  | FloorPlanCircleAnnotation;

/** In-progress CAD-style polyline: clicked vertices plus a rubber-band to the cursor. */
export type LineDraft = {
  points: PdfPoint[];
  cursor: PdfPoint;
  /** Color of secured vertices; the rubber-band uses the current tool stroke color. */
  segmentColor: string;
  snapKind?: SnapKind | null;
  snapSegment?: SnapSegment;
  alignXThrough?: PdfPoint;
  alignYThrough?: PdfPoint;
};

export type BoundingBoxDraft = {
  shape: "rectangle" | "circle";
  start: PdfPoint;
  current: PdfPoint;
  variant: ShapeCrossVariant;
  snapKind?: SnapKind | null;
  snapSegment?: SnapSegment;
  alignXThrough?: PdfPoint;
  alignYThrough?: PdfPoint;
};

/** @deprecated Use {@link BoundingBoxDraft}. */
export type RectangleDraft = BoundingBoxDraft;

/** Marquee selection in select mode (PDF points, origin bottom-left). */
export type SelectionDraft = {
  start: PdfPoint;
  current: PdfPoint;
};

/** Hover target on a polyline vertex in select mode. */
export type VertexHover = {
  annotationIndex: number;
  pointIndex: number;
};

/** Active vertex drag in select mode. */
export type VertexDragDraft = {
  annotationIndex: number;
  pointIndex: number;
  snapKind?: SnapKind | null;
  snapSegment?: SnapSegment;
  alignXThrough?: PdfPoint;
  alignYThrough?: PdfPoint;
};

export type CutDraftPoint = {
  annotationIndex: number;
  segmentIndex: number;
  t: number;
  point: PdfPoint;
  snapKind: "endpoint" | "on-line";
  snapSegment?: SnapSegment;
};

/** Two cut points on the same line sever the segment between them. */
export type CutDraft = {
  first?: CutDraftPoint;
  cursor: PdfPoint;
  snapKind?: "endpoint" | "on-line" | null;
  snapSegment?: SnapSegment;
};

export type DrawColorPreset = {
  color: string;
  label: string;
  /** Single letter or digit hotkey (lowercase when persisted). */
  shortcut?: string;
};

/** Tool keys reserved for draw-mode shortcuts (V/L/R/O/C/K). */
export const DRAW_TOOL_SHORTCUT_KEYS = new Set(["v", "l", "r", "o", "c", "k"]);

export const DEFAULT_DRAW_COLOR_PRESETS: DrawColorPreset[] = [
  { color: "#dc2626", label: "Structural wall" },
  { color: "#2563eb", label: "Interior" },
  { color: "#16a34a", label: "Structural wall exterior" },
  { color: "#ca8a04", label: "Doors and windows" },
  { color: "#9333ea", label: "Other" },
  { color: "#0f172a", label: "Misc" },
];

/** Preset stroke colors (hex). Labels live in {@link DrawColorPreset}. */
export const DRAW_COLORS = DEFAULT_DRAW_COLOR_PRESETS.map(
  (preset) => preset.color,
) as readonly string[];

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function normalizeHexColor(color: string): string {
  if (color.length === 4 && color.startsWith("#")) {
    const r = color[1];
    const g = color[2];
    const b = color[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return color.toLowerCase();
}

/** Normalize a single-letter or digit shortcut; rejects tool keys V/L/R/O/C/K. */
export function normalizeDrawColorShortcut(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const char = trimmed.length === 1 ? trimmed : trimmed[0];
  if (!/^[a-zA-Z0-9]$/.test(char)) return undefined;
  const normalized = char.toLowerCase();
  if (DRAW_TOOL_SHORTCUT_KEYS.has(normalized)) return undefined;
  return normalized;
}

export function findDrawColorPresetByShortcut(
  presets: DrawColorPreset[],
  key: string,
): DrawColorPreset | undefined {
  const normalized = normalizeDrawColorShortcut(key);
  if (!normalized) return undefined;
  return presets.find((preset) => preset.shortcut === normalized);
}

/** Parse persisted preset list; invalid entries are dropped. */
export function parseDrawColorPresets(raw: unknown): DrawColorPreset[] {
  if (raw == null) return [...DEFAULT_DRAW_COLOR_PRESETS];

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [...DEFAULT_DRAW_COLOR_PRESETS];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [...DEFAULT_DRAW_COLOR_PRESETS];
    }
  }

  if (!Array.isArray(parsed)) return [...DEFAULT_DRAW_COLOR_PRESETS];

  const result: DrawColorPreset[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item == null) continue;
    const entry = item as Record<string, unknown>;
    const color =
      typeof entry.color === "string" ? entry.color.trim() : "";
    const label =
      typeof entry.label === "string" ? entry.label.trim() : "";
    if (!isHexColor(color)) continue;
    const preset: DrawColorPreset = {
      color: normalizeHexColor(color),
      label: label || "Untitled",
    };
    if (typeof entry.shortcut === "string") {
      const shortcut = normalizeDrawColorShortcut(entry.shortcut);
      if (shortcut) preset.shortcut = shortcut;
    }
    result.push(preset);
  }

  return result.length > 0
    ? result
    : [...DEFAULT_DRAW_COLOR_PRESETS];
}

export function drawColorPresetsEqual(
  a: DrawColorPreset[],
  b: DrawColorPreset[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const STROKE_WIDTHS_PT = [0.5, 1, 2, 3, 5, 8] as const;

export function pdfRectFromCorners(a: PdfPoint, b: PdfPoint): PdfRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Lock drag corner so width and height match (square bounding box / circle). */
export function constrainBoxCorner(
  start: PdfPoint,
  end: PdfPoint,
  square: boolean,
): PdfPoint {
  if (!square) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  const signX = dx === 0 ? 1 : Math.sign(dx);
  const signY = dy === 0 ? 1 : Math.sign(dy);
  return {
    x: start.x + signX * size,
    y: start.y + signY * size,
  };
}

export function pdfRectFromBoxCorners(
  start: PdfPoint,
  end: PdfPoint,
  square = false,
): PdfRect {
  return pdfRectFromCorners(start, constrainBoxCorner(start, end, square));
}

function pointInPdfRect(point: PdfPoint, rect: PdfRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function orientation(a: PdfPoint, b: PdfPoint, c: PdfPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: PdfPoint, b: PdfPoint, c: PdfPoint): boolean {
  return (
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(a1: PdfPoint, a2: PdfPoint, b1: PdfPoint, b2: PdfPoint): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) {
    return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
  }
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
}

function segmentIntersectsPdfRect(a: PdfPoint, b: PdfPoint, rect: PdfRect): boolean {
  if (pointInPdfRect(a, rect) || pointInPdfRect(b, rect)) return true;
  const corners: PdfPoint[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  for (let i = 0; i < 4; i++) {
    const c1 = corners[i];
    const c2 = corners[(i + 1) % 4];
    if (segmentsIntersect(a, b, c1, c2)) return true;
  }
  return false;
}

function pdfRectsOverlap(a: PdfRect, b: PdfRect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/** True when any part of the annotation crosses or lies inside the selection rect. */
export function annotationIntersectsRect(
  item: FloorPlanAnnotation,
  rect: PdfRect,
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (item.type === "rectangle" || item.type === "circle") {
    return pdfRectsOverlap(item.rect, rect);
  }
  for (let i = 0; i < item.points.length - 1; i++) {
    if (segmentIntersectsPdfRect(item.points[i], item.points[i + 1], rect)) {
      return true;
    }
  }
  return false;
}

export function indicesInSelectionRect(
  annotations: FloorPlanAnnotation[],
  rect: PdfRect,
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < annotations.length; i++) {
    if (annotationIntersectsRect(annotations[i], rect)) {
      indices.push(i);
    }
  }
  return indices;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPdfPoint(value: unknown): value is PdfPoint {
  if (typeof value !== "object" || value == null) return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function isPdfRect(value: unknown): value is PdfRect {
  if (typeof value !== "object" || value == null) return false;
  const rect = value as Record<string, unknown>;
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isAnnotation(value: unknown): value is FloorPlanAnnotation {
  if (typeof value !== "object" || value == null) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.color !== "string" ||
    !isFiniteNumber(item.strokeWidthPt) ||
    item.strokeWidthPt <= 0
  ) {
    return false;
  }
  if (item.type === "polyline") {
    return (
      Array.isArray(item.points) &&
      item.points.length >= 2 &&
      item.points.every(isPdfPoint)
    );
  }
  if (item.type === "rectangle" || item.type === "circle") {
    if (!isPdfRect(item.rect)) return false;
    if (
      item.variant != null &&
      item.variant !== "plain" &&
      item.variant !== "cross"
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function sanitizeRiserFields(item: FloorPlanAnnotation): FloorPlanAnnotation {
  if (item.type !== "rectangle" && item.type !== "circle") return item;
  const record = item as FloorPlanAnnotation & Record<string, unknown>;
  if (
    !("id" in record) &&
    !("riserPartnerId" in record) &&
    !("riserRole" in record)
  ) {
    return item;
  }
  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : undefined;
  const partner =
    typeof record.riserPartnerId === "string" && record.riserPartnerId.trim()
      ? record.riserPartnerId.trim()
      : undefined;
  const role =
    record.riserRole === "above" || record.riserRole === "below"
      ? record.riserRole
      : undefined;
  const next: FloorPlanRectangleAnnotation | FloorPlanCircleAnnotation = {
    type: item.type,
    rect: item.rect,
    color: item.color,
    strokeWidthPt: item.strokeWidthPt,
  };
  if (item.variant) next.variant = item.variant;
  if (id && partner && role) {
    next.id = id;
    next.riserPartnerId = partner;
    next.riserRole = role;
  }
  return next;
}

/** Parse persisted markup JSON; invalid entries are dropped. */
export function parseFloorPlanAnnotations(raw: unknown): FloorPlanAnnotation[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isAnnotation).map(sanitizeRiserFields);
}

export function floorPlanAnnotationsEqual(
  a: FloorPlanAnnotation[],
  b: FloorPlanAnnotation[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const GEOMETRY_EPS_PT = 0.05;

function pointsEqual(a: PdfPoint, b: PdfPoint, eps = GEOMETRY_EPS_PT): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/** True when two annotations occupy the same geometry (ignoring minor float drift). */
export function annotationsGeometricallyEqual(
  a: FloorPlanAnnotation,
  b: FloorPlanAnnotation,
): boolean {
  if (a.type !== b.type) return false;
  if (Math.abs(a.strokeWidthPt - b.strokeWidthPt) > GEOMETRY_EPS_PT) {
    return false;
  }
  if (a.type === "polyline" && b.type === "polyline") {
    if (a.points.length !== b.points.length) return false;
    return a.points.every((point, index) =>
      pointsEqual(point, b.points[index]),
    );
  }
  if (a.type === "rectangle" || a.type === "circle") {
    if (a.type !== b.type) return false;
    const aRect = a.rect;
    const bRect = b.rect;
    const aVariant = a.variant ?? "plain";
    const bVariant = b.variant ?? "plain";
    return (
      aVariant === bVariant &&
      pointsEqual({ x: aRect.x, y: aRect.y }, { x: bRect.x, y: bRect.y }) &&
      pointsEqual(
        { x: aRect.x + aRect.width, y: aRect.y + aRect.height },
        { x: bRect.x + bRect.width, y: bRect.y + bRect.height },
      )
    );
  }
  return false;
}

/** Normalize stroke hex for preset / filter comparison (#abc → #aabbcc, lowercase). */
export function normalizeStrokeColor(color: string): string {
  return normalizeHexColor(color);
}

/** `'all'` keeps every annotation; otherwise only matching preset stroke colors. */
export type StrokeColorFilter = "all" | string[];

export function filterAnnotationsByStrokeColors(
  annotations: FloorPlanAnnotation[],
  filter: StrokeColorFilter,
): FloorPlanAnnotation[] {
  if (filter === "all") return annotations;
  if (filter.length === 0) return [];
  const allowed = new Set(filter.map((color) => normalizeHexColor(color)));
  return annotations.filter((item) =>
    allowed.has(normalizeHexColor(item.color)),
  );
}

/** Drop overlay ghosts that match saved or user-hidden markup on this floor. */
export function excludeMatchingOverlayAnnotations(
  saved: FloorPlanAnnotation[],
  overlay: FloorPlanAnnotation[],
): FloorPlanAnnotation[] {
  if (overlay.length === 0 || saved.length === 0) return overlay;
  return overlay.filter(
    (item) => !saved.some((savedItem) => annotationsGeometricallyEqual(savedItem, item)),
  );
}

function crossPlanScaleFactor(
  overlayFamily: { scaleDenominator?: number | null },
  anchorFamily: { scaleDenominator?: number | null },
): number {
  const overlayDenominator = overlayFamily.scaleDenominator;
  const anchorDenominator = anchorFamily.scaleDenominator;
  if (
    overlayDenominator == null ||
    anchorDenominator == null ||
    overlayDenominator <= 0 ||
    anchorDenominator <= 0
  ) {
    return 1;
  }
  // Same real-world distance spans fewer PDF points on coarser (higher) scales.
  return overlayDenominator / anchorDenominator;
}

/** Map a point from one floor's original PDF into another's, pin- and scale-aligned. */
export function mapPdfPointAcrossPlans(
  point: PdfPoint,
  overlayPin: PdfPoint,
  anchorPin: PdfPoint,
  overlayFamily: { scaleDenominator?: number | null },
  anchorFamily: { scaleDenominator?: number | null },
): PdfPoint {
  const scaleFactor = crossPlanScaleFactor(overlayFamily, anchorFamily);
  return {
    x: anchorPin.x + (point.x - overlayPin.x) * scaleFactor,
    y: anchorPin.y + (point.y - overlayPin.y) * scaleFactor,
  };
}

/** Map saved markup from one floor onto the sheet being edited. */
export function mapAnnotationsAcrossPlans(
  annotations: FloorPlanAnnotation[],
  overlayPin: PdfPoint,
  anchorPin: PdfPoint,
  overlayFamily: { scaleDenominator?: number | null },
  anchorFamily: { scaleDenominator?: number | null },
): FloorPlanAnnotation[] {
  const mapPoint = (point: PdfPoint) =>
    mapPdfPointAcrossPlans(
      point,
      overlayPin,
      anchorPin,
      overlayFamily,
      anchorFamily,
    );

  return annotations.map((item) => {
    if (item.type === "polyline") {
      return {
        ...item,
        points: item.points.map(mapPoint),
      };
    }
    const topLeft = mapPoint({ x: item.rect.x, y: item.rect.y + item.rect.height });
    const bottomRight = mapPoint({
      x: item.rect.x + item.rect.width,
      y: item.rect.y,
    });
    return {
      ...item,
      rect: pdfRectFromCorners(topLeft, bottomRight),
    };
  });
}

/** Map markup stored on the original PDF into cropped-plate coordinates. */
export function mapAnnotationsToCroppedPlate(
  annotations: FloorPlanAnnotation[],
  cropOrigin: PdfPoint,
): FloorPlanAnnotation[] {
  const mapPoint = (point: PdfPoint): PdfPoint => ({
    x: point.x - cropOrigin.x,
    y: point.y - cropOrigin.y,
  });

  return annotations.map((item) => {
    if (item.type === "polyline") {
      return {
        ...item,
        points: item.points.map(mapPoint),
      };
    }
    const topLeft = mapPoint({
      x: item.rect.x,
      y: item.rect.y + item.rect.height,
    });
    const bottomRight = mapPoint({
      x: item.rect.x + item.rect.width,
      y: item.rect.y,
    });
    return {
      ...item,
      rect: pdfRectFromCorners(topLeft, bottomRight),
    };
  });
}
