/** Markup shapes drawn on floor-plan PDFs. Coordinates are PDF points (origin bottom-left). */

import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import type { SnapKind, SnapSegment } from "@/lib/building/floor-plan-draw-snap";

export type DrawTool =
  | "none"
  | "line"
  | "rectangle"
  | "circle"
  | "room"
  | "cut"
  | "connect"
  | "callout"
  | "rotate";

/** Mechanical labeling pass. Omitted on saved markup = first pass (existing work). */
export const MECHANICAL_MARKUP_SETS = [1, 2] as const;
export type MechanicalMarkupSet = (typeof MECHANICAL_MARKUP_SETS)[number];
export const DEFAULT_MECHANICAL_MARKUP_SET: MechanicalMarkupSet = 1;

type MarkupSetFields = {
  markupSet?: MechanicalMarkupSet;
};

/** Text bubble whose leader stays attached to a rectangle or circle. */
export type FloorPlanCallout = {
  /** Bubble center in PDF points (origin bottom-left). */
  x: number;
  y: number;
  /** Denormalized label; mechanical callouts prefer {@link riserId}. */
  text: string;
  /** Catalog instance when this label is a mechanical riser. */
  riserId?: string;
  /** Multiple catalog instances on one callout (e.g. Riser - Kitchen B2, B3). */
  riserIds?: string[];
  /** Catalog type chosen before a number is assigned. */
  typeId?: string;
};

/** Which end of a riser-offset pair continues to the floor above. */
export type RiserRole = "above" | "below";

type BoxRiserFields = {
  /** Assigned when the box is linked as a riser offset pair. */
  id?: string;
  /** First opposite-role partner; kept for 1:1 JSON. */
  riserPartnerId?: string;
  /**
   * Every opposite-role partner when a shaft splits (B11 and B12 from one
   * combined box). Omitted when there is only one partner.
   */
  riserPartnerIds?: string[];
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
} & MarkupSetFields;

type BoxCalloutFields = {
  callout?: FloorPlanCallout;
};

type BoxRotationFields = {
  /**
   * Degrees around {@link pdfRectCenter}, omitted at 0.
   * PDF space: counter-clockwise from +X with origin bottom-left.
   */
  rotationDeg?: number;
};

export type FloorPlanRectangleAnnotation = {
  type: "rectangle";
  rect: PdfRect;
  /** Omitted or `"plain"` — four sides only; `"cross"` adds both diagonals. */
  variant?: ShapeCrossVariant;
  /** True when the shape has a solid fill of `color`. */
  filled?: boolean;
  color: string;
  strokeWidthPt: number;
} & BoxRotationFields &
  BoxRiserFields &
  BoxCalloutFields &
  MarkupSetFields;

export type FloorPlanCircleAnnotation = {
  type: "circle";
  /** Axis-aligned bounding box (ellipse inscribed). */
  rect: PdfRect;
  /** Omitted or `"plain"` — ellipse only; `"cross"` adds both diagonals. */
  variant?: ShapeCrossVariant;
  /** True when the shape has a solid fill of `color`. */
  filled?: boolean;
  color: string;
  strokeWidthPt: number;
} & BoxRotationFields &
  BoxRiserFields &
  BoxCalloutFields &
  MarkupSetFields;

/** Closed unit polygon traced from wall faces; `points` is an open ring. */
export type FloorPlanRoomAnnotation = {
  type: "room";
  points: PdfPoint[];
  /** Unit number or other freeform label. */
  label: string;
  color: string;
  strokeWidthPt: number;
} & MarkupSetFields;

export type FloorPlanAnnotation =
  | FloorPlanPolylineAnnotation
  | FloorPlanRectangleAnnotation
  | FloorPlanCircleAnnotation
  | FloorPlanRoomAnnotation;

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

export const DRAW_COLOR_FAMILIES = ["architectural", "mechanical"] as const;
export type DrawColorFamily = (typeof DRAW_COLOR_FAMILIES)[number];

export type DrawColorPreset = {
  color: string;
  label: string;
  /** Single letter or digit hotkey (lowercase when persisted). */
  shortcut?: string;
  /** Architectural vs mechanical — overlay source and legend grouping. */
  family: DrawColorFamily;
  /** Mechanical catalog type id when this row is a riser function. */
  typeId?: string;
};

/** Tool keys reserved for draw-mode shortcuts (V/L/R/O/U/C/K/A/T). */
export const DRAW_TOOL_SHORTCUT_KEYS = new Set([
  "v",
  "l",
  "r",
  "o",
  "u",
  "c",
  "k",
  "a",
  "t",
]);

export const DEFAULT_DRAW_COLOR_PRESETS: DrawColorPreset[] = [
  { color: "#dc2626", label: "Structural wall", family: "architectural" },
  { color: "#2563eb", label: "Interior", family: "architectural" },
  { color: "#16a34a", label: "Structural wall exterior", family: "architectural" },
  { color: "#ca8a04", label: "Doors and windows", family: "architectural" },
  { color: "#9333ea", label: "Other", family: "architectural" },
  { color: "#0f172a", label: "Misc", family: "architectural" },
];

const DEFAULT_DRAW_COLOR_SET = new Set(
  DEFAULT_DRAW_COLOR_PRESETS.map((preset) => preset.color),
);

export function parseDrawColorFamily(value: unknown): DrawColorFamily | null {
  return value === "mechanical" || value === "architectural" ? value : null;
}

export function drawColorFamilyLabel(family: DrawColorFamily): string {
  return family === "mechanical" ? "Mechanical" : "Architectural";
}

/**
 * Legacy presets have no family. Built-in wall colors stay architectural;
 * anything else (user-added equipment types) is mechanical.
 */
function inferLegacyDrawColorFamily(color: string): DrawColorFamily {
  return DEFAULT_DRAW_COLOR_SET.has(color) ? "architectural" : "mechanical";
}

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

/** Normalize a single-letter or digit shortcut; rejects tool keys V/L/R/O/U/C/K/A/T. */
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
    const normalizedColor = normalizeHexColor(color);
    const family =
      parseDrawColorFamily(entry.family) ??
      inferLegacyDrawColorFamily(normalizedColor);
    const preset: DrawColorPreset = {
      color: normalizedColor,
      label: label || "Untitled",
      family,
    };
    if (typeof entry.shortcut === "string") {
      const shortcut = normalizeDrawColorShortcut(entry.shortcut);
      if (shortcut) preset.shortcut = shortcut;
    }
    if (typeof entry.typeId === "string" && entry.typeId.trim()) {
      preset.typeId = entry.typeId.trim();
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

export function pdfRectCenter(rect: PdfRect): PdfPoint {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/** Shift-rotate snaps to these world angles (degrees). */
export const BOX_ROTATION_SNAP_DEG = 45;

const ROTATION_EPS_DEG = 1e-6;

/** Wrap to `[0, 360)`; values within epsilon of 0 or 360 become 0. */
export function normalizeAnnotationRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let next = deg % 360;
  if (next < 0) next += 360;
  if (next < ROTATION_EPS_DEG || next > 360 - ROTATION_EPS_DEG) return 0;
  return next;
}

export function annotationRotationDeg(item: {
  rotationDeg?: number;
}): number {
  return item.rotationDeg == null
    ? 0
    : normalizeAnnotationRotationDeg(item.rotationDeg);
}

export function snapAnnotationRotationDeg(deg: number): number {
  const snapped =
    Math.round(deg / BOX_ROTATION_SNAP_DEG) * BOX_ROTATION_SNAP_DEG;
  return normalizeAnnotationRotationDeg(snapped);
}

/** PDF-space rotation: counter-clockwise around `center` (Y up). */
export function rotatePdfPointAround(
  point: PdfPoint,
  center: PdfPoint,
  deg: number,
): PdfPoint {
  const angle = normalizeAnnotationRotationDeg(deg);
  if (angle === 0) return point;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function rotatePdfPointsAround(
  points: PdfPoint[],
  center: PdfPoint,
  deg: number,
): PdfPoint[] {
  const angle = normalizeAnnotationRotationDeg(deg);
  if (angle === 0) return points;
  return points.map((point) => rotatePdfPointAround(point, center, angle));
}

export function withAnnotationRotation<T extends { rotationDeg?: number }>(
  item: T,
  deg: number,
): T {
  const next = normalizeAnnotationRotationDeg(deg);
  if (next === 0) {
    if (item.rotationDeg == null) return item;
    const copy = { ...item };
    delete copy.rotationDeg;
    return copy;
  }
  if (item.rotationDeg === next) return item;
  return { ...item, rotationDeg: next };
}

export function pdfPointAngleDeg(point: PdfPoint, origin: PdfPoint): number {
  return (Math.atan2(point.y - origin.y, point.x - origin.x) * 180) / Math.PI;
}

/**
 * Rotation while click-holding: pointer delta from the grab angle, plus the
 * box's starting rotation. Shift snaps the result to 45° world increments.
 */
export function rotationFromPointerDrag(
  startPointer: PdfPoint,
  currentPointer: PdfPoint,
  center: PdfPoint,
  startRotationDeg: number,
  snap: boolean,
): number {
  const startAngle = pdfPointAngleDeg(startPointer, center);
  const currentAngle = pdfPointAngleDeg(currentPointer, center);
  const next = startRotationDeg + (currentAngle - startAngle);
  return snap
    ? snapAnnotationRotationDeg(next)
    : normalizeAnnotationRotationDeg(next);
}

export function rotatedPdfRectBounds(rect: PdfRect, deg: number): PdfRect {
  const angle = normalizeAnnotationRotationDeg(deg);
  if (angle === 0) return rect;
  const center = pdfRectCenter(rect);
  const corners = rotatePdfPointsAround(
    [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ],
    center,
    angle,
  );
  let minX = corners[0]!.x;
  let minY = corners[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (let i = 1; i < corners.length; i++) {
    const point = corners[i]!;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Axis-aligned bounds in PDF points. Polylines and rooms use their vertex hull. */
export function annotationPdfBounds(item: FloorPlanAnnotation): PdfRect | null {
  if (item.type === "rectangle" || item.type === "circle") {
    return rotatedPdfRectBounds(item.rect, annotationRotationDeg(item));
  }
  if (
    (item.type !== "polyline" && item.type !== "room") ||
    item.points.length === 0
  ) {
    return null;
  }
  let minX = item.points[0]!.x;
  let minY = item.points[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (let i = 1; i < item.points.length; i++) {
    const point = item.points[i]!;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** PDF-point bounds for markup rendering (page box plus every annotation hull). */
export type PdfMarkupExtent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const DEFAULT_MARKUP_EXTENT_PADDING_PT = 48;

/** Union of the page MediaBox and all annotation bounds, with optional padding. */
export function pdfMarkupExtent(
  pageWidth: number,
  pageHeight: number,
  annotations: FloorPlanAnnotation[],
  paddingPt = DEFAULT_MARKUP_EXTENT_PADDING_PT,
): PdfMarkupExtent {
  let minX = 0;
  let minY = 0;
  let maxX = pageWidth;
  let maxY = pageHeight;
  for (const item of annotations) {
    const bounds = annotationPdfBounds(item);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  if (paddingPt > 0) {
    minX -= paddingPt;
    minY -= paddingPt;
    maxX += paddingPt;
    maxY += paddingPt;
  }
  return { minX, minY, maxX, maxY };
}

/** True when markup extends outside the PDF page MediaBox. */
export function markupExtentExceedsPage(
  extent: PdfMarkupExtent,
  pageWidth: number,
  pageHeight: number,
  eps = 0.5,
): boolean {
  return (
    extent.minX < -eps ||
    extent.minY < -eps ||
    extent.maxX > pageWidth + eps ||
    extent.maxY > pageHeight + eps
  );
}

/** Translate a shape and its callout by PDF-point deltas. */
export function offsetAnnotation(
  item: FloorPlanAnnotation,
  dx: number,
  dy: number,
): FloorPlanAnnotation {
  if (dx === 0 && dy === 0) return item;
  if (item.type === "polyline" || item.type === "room") {
    return {
      ...item,
      points: item.points.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      })),
    };
  }
  return {
    ...item,
    rect: {
      ...item.rect,
      x: item.rect.x + dx,
      y: item.rect.y + dy,
    },
    callout: item.callout
      ? {
          ...item.callout,
          x: item.callout.x + dx,
          y: item.callout.y + dy,
        }
      : item.callout,
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
    return pdfRectsOverlap(
      rotatedPdfRectBounds(item.rect, annotationRotationDeg(item)),
      rect,
    );
  }
  const closed = item.type === "room";
  const last = closed ? item.points.length : item.points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = item.points[i];
    const b = item.points[(i + 1) % item.points.length];
    if (a && b && segmentIntersectsPdfRect(a, b, rect)) {
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

function applyMarkupSet<T extends MarkupSetFields>(
  source: Record<string, unknown>,
  next: T,
): void {
  if (parseMechanicalMarkupSet(source.markupSet) === 2) {
    next.markupSet = 2;
  }
}

export function parseMechanicalMarkupSet(value: unknown): MechanicalMarkupSet {
  return value === 2 || value === "2" ? 2 : 1;
}

export function annotationMarkupSet(
  item: FloorPlanAnnotation,
): MechanicalMarkupSet {
  return parseMechanicalMarkupSet(item.markupSet);
}

export function stampAnnotationMarkupSet(
  item: FloorPlanAnnotation,
  set: MechanicalMarkupSet,
): FloorPlanAnnotation {
  if (set === 1) {
    if (item.markupSet == null || item.markupSet === 1) return item;
    const next = { ...item };
    delete next.markupSet;
    return next;
  }
  if (item.markupSet === 2) return item;
  return { ...item, markupSet: 2 };
}

export function filterAnnotationsByMarkupSet(
  annotations: FloorPlanAnnotation[],
  set: MechanicalMarkupSet,
): FloorPlanAnnotation[] {
  return annotations.filter((item) => annotationMarkupSet(item) === set);
}

/** Replace the active pass in `all` with `active` (stamped), keep the other pass. */
export function mergeAnnotationsByMarkupSet(
  all: FloorPlanAnnotation[],
  active: FloorPlanAnnotation[],
  set: MechanicalMarkupSet,
): FloorPlanAnnotation[] {
  const inactive = all.filter((item) => annotationMarkupSet(item) !== set);
  return [
    ...inactive,
    ...active.map((item) => stampAnnotationMarkupSet(item, set)),
  ];
}

function isCallout(value: unknown): value is FloorPlanCallout {
  if (typeof value !== "object" || value == null) return false;
  const callout = value as Record<string, unknown>;
  return (
    isFiniteNumber(callout.x) &&
    isFiniteNumber(callout.y) &&
    typeof callout.text === "string"
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
  if (item.type === "room") {
    return (
      Array.isArray(item.points) &&
      item.points.length >= 3 &&
      item.points.every(isPdfPoint) &&
      typeof item.label === "string"
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

function sanitizeAnnotation(item: FloorPlanAnnotation): FloorPlanAnnotation {
  const record = item as FloorPlanAnnotation & Record<string, unknown>;
  if (item.type === "polyline") {
    const next: FloorPlanPolylineAnnotation = {
      type: "polyline",
      points: item.points,
      color: item.color,
      strokeWidthPt: item.strokeWidthPt,
    };
    applyMarkupSet(record, next);
    return next;
  }
  if (item.type === "room") {
    const next: FloorPlanRoomAnnotation = {
      type: "room",
      points: item.points,
      label: item.label,
      color: item.color,
      strokeWidthPt: item.strokeWidthPt,
    };
    applyMarkupSet(record, next);
    return next;
  }
  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : undefined;
  const partner =
    typeof record.riserPartnerId === "string" && record.riserPartnerId.trim()
      ? record.riserPartnerId.trim()
      : undefined;
  const partners: string[] = [];
  const seenPartners = new Set<string>();
  const addPartner = (value: string) => {
    if (!value || seenPartners.has(value)) return;
    seenPartners.add(value);
    partners.push(value);
  };
  if (partner) addPartner(partner);
  if (Array.isArray(record.riserPartnerIds)) {
    for (const entry of record.riserPartnerIds) {
      if (typeof entry === "string") addPartner(entry.trim());
    }
  }
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
  if (record.filled === true) next.filled = true;
  const rotationDeg = annotationRotationDeg(item);
  if (rotationDeg !== 0) next.rotationDeg = rotationDeg;
  if (id && role && partners.length > 0) {
    next.id = id;
    next.riserPartnerId = partners[0];
    next.riserRole = role;
    if (partners.length > 1) next.riserPartnerIds = partners;
  }
  if (isCallout(record.callout)) {
    next.callout = {
      x: record.callout.x,
      y: record.callout.y,
      text: record.callout.text,
    };
    const riserId =
      typeof record.callout.riserId === "string"
        ? record.callout.riserId.trim()
        : "";
    if (riserId) next.callout.riserId = riserId;
    if (Array.isArray(record.callout.riserIds)) {
      const riserIds = record.callout.riserIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (riserIds.length > 0) {
        next.callout.riserIds = riserIds;
        if (!next.callout.riserId) next.callout.riserId = riserIds[0];
      }
    }
    const typeId =
      typeof record.callout.typeId === "string"
        ? record.callout.typeId.trim()
        : "";
    if (typeId) next.callout.typeId = typeId;
  }
  applyMarkupSet(record, next);
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
  return parsed.filter(isAnnotation).map(sanitizeAnnotation);
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
  if (a.type === "room" && b.type === "room") {
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
    const rotationDelta = Math.abs(
      annotationRotationDeg(a) - annotationRotationDeg(b),
    );
    return (
      aVariant === bVariant &&
      (rotationDelta <= GEOMETRY_EPS_PT || rotationDelta >= 360 - GEOMETRY_EPS_PT) &&
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

export function strokeColorFilterHasSelection(
  filter: StrokeColorFilter,
): boolean {
  return filter === "all" || filter.length > 0;
}

export function presetDrawColorFamily(preset: DrawColorPreset): DrawColorFamily {
  return (
    parseDrawColorFamily(preset.family) ??
    inferLegacyDrawColorFamily(normalizeHexColor(preset.color))
  );
}

export function presetsInFamily(
  presets: DrawColorPreset[],
  family: DrawColorFamily,
): DrawColorPreset[] {
  return presets.filter((preset) => presetDrawColorFamily(preset) === family);
}

/** Colors from `family` that are currently visible in the overlay filter. */
export function selectedStrokeColorsForFamily(
  filter: StrokeColorFilter,
  presets: DrawColorPreset[],
  family: DrawColorFamily,
): string[] {
  const colors = presetsInFamily(presets, family).map((preset) =>
    normalizeHexColor(preset.color),
  );
  if (filter === "all") return colors;
  const allowed = new Set(filter.map((color) => normalizeHexColor(color)));
  return colors.filter((color) => allowed.has(color));
}

/**
 * Filter to apply to overlay lines from one drawing set.
 * `"all"` keeps unknown colors on that source; a color list is only the
 * selected types that belong to this family.
 */
export function lineOverlayFilterForFamily(
  filter: StrokeColorFilter,
  presets: DrawColorPreset[],
  family: DrawColorFamily,
): StrokeColorFilter {
  if (filter === "all") return "all";
  return selectedStrokeColorsForFamily(filter, presets, family);
}

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
    if (item.type === "polyline" || item.type === "room") {
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
    const callout = item.callout
      ? {
          ...item.callout,
          ...mapPoint({ x: item.callout.x, y: item.callout.y }),
        }
      : undefined;
    return {
      ...item,
      rect: pdfRectFromCorners(topLeft, bottomRight),
      ...(callout ? { callout } : {}),
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
    if (item.type === "polyline" || item.type === "room") {
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
    const callout = item.callout
      ? {
          ...item.callout,
          ...mapPoint({ x: item.callout.x, y: item.callout.y }),
        }
      : undefined;
    return {
      ...item,
      rect: pdfRectFromCorners(topLeft, bottomRight),
      ...(callout ? { callout } : {}),
    };
  });
}
