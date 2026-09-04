/** Snap and angle-constraint helpers for floor-plan markup drawing. */

import type { PdfPoint } from "@/lib/building/floor-plan-align";
import type {
  FloorPlanAnnotation,
  ShapeCrossVariant,
} from "@/lib/building/floor-plan-annotations";
import {
  annotationRotationDeg,
  pdfRectCenter,
  rotatePdfPointAround,
  rotatePdfPointsAround,
} from "@/lib/building/floor-plan-annotations";
import { ellipseCrossDiagonalSegments } from "@/lib/building/floor-plan-polyline-cut";
import { pointInPolygon } from "@/lib/building/floor-plan-rooms";

const EPS = 1e-9;
const ORTHO_STEP = Math.PI / 4;

export type SnapOptions = {
  /** Skip collinear and axis-alignment extension snaps (endpoint / on-line still apply). */
  disableExtensionSnaps?: boolean;
};

export type SnapKind =
  | "endpoint"
  | "on-line"
  | "collinear"
  | "align-x"
  | "align-y"
  | "align-xy";

export type SnapSegment = { a: PdfPoint; b: PdfPoint };

export type SnapResult = {
  point: PdfPoint;
  kind: SnapKind | null;
  segment?: SnapSegment;
  /** Cursor or anchor — used to orient the perpendicular on-line indicator. */
  approachFrom?: PdfPoint;
  /** Endpoint whose X drives a vertical alignment extension guide. */
  alignXThrough?: PdfPoint;
  /** Endpoint whose Y drives a horizontal alignment extension guide. */
  alignYThrough?: PdfPoint;
};

type Segment = { a: PdfPoint; b: PdfPoint };

function rotateItemSegments(
  item: FloorPlanAnnotation,
  segments: Segment[],
): Segment[] {
  if (item.type === "polyline" || item.type === "room") return segments;
  const deg = annotationRotationDeg(item);
  if (deg === 0) return segments;
  const center = pdfRectCenter(item.rect);
  return segments.map((segment) => ({
    a: rotatePdfPointAround(segment.a, center, deg),
    b: rotatePdfPointAround(segment.b, center, deg),
  }));
}

function rotateItemPoints(
  item: FloorPlanAnnotation,
  points: PdfPoint[],
): PdfPoint[] {
  if (item.type === "polyline" || item.type === "room") return points;
  const deg = annotationRotationDeg(item);
  if (deg === 0) return points;
  return rotatePdfPointsAround(points, pdfRectCenter(item.rect), deg);
}

type SnapCandidate = {
  point: PdfPoint;
  kind: SnapKind;
  distSq: number;
  priority: number;
  segment?: SnapSegment;
  alignXThrough?: PdfPoint;
  alignYThrough?: PdfPoint;
};

const SNAP_PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  "on-line": 1,
  collinear: 2,
  "align-xy": 3,
  "align-x": 4,
  "align-y": 5,
};

function distSq(a: PdfPoint, b: PdfPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pickBestCandidate(candidates: SnapCandidate[]): SnapResult | null {
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.distSq - b.distSq;
  });
  const best = candidates[0];
  return {
    point: { ...best.point },
    kind: best.kind,
    segment: best.segment,
    alignXThrough: best.alignXThrough,
    alignYThrough: best.alignYThrough,
  };
}

function alignKind(hasX: boolean, hasY: boolean): SnapKind {
  if (hasX && hasY) return "align-xy";
  if (hasX) return "align-x";
  return "align-y";
}

/** Nearest point on segment `ab` to `p`. */
export function nearestPointOnSegment(
  p: PdfPoint,
  a: PdfPoint,
  b: PdfPoint,
): PdfPoint {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < EPS) return { ...a };
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq),
  );
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Nearest point on the infinite line through `ab` to `p`. */
export function nearestPointOnInfiniteLine(
  p: PdfPoint,
  a: PdfPoint,
  b: PdfPoint,
): PdfPoint {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < EPS) return { ...a };
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Lock `target` to H/V/45° from `origin`, keeping cursor distance. */
export function constrainToOrthoDiagonal(
  origin: PdfPoint,
  target: PdfPoint,
): PdfPoint {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist < EPS) return { ...origin };
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / ORTHO_STEP) * ORTHO_STEP;
  return {
    x: origin.x + Math.cos(snapped) * dist,
    y: origin.y + Math.sin(snapped) * dist,
  };
}

function crossDiagonalSegments(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Segment[] {
  const { x, y, width, height } = rect;
  const bl = { x, y };
  const br = { x: x + width, y };
  const tr = { x: x + width, y: y + height };
  const tl = { x, y: y + height };
  return [
    { a: bl, b: tr },
    { a: br, b: tl },
  ];
}

function rectangleSegments(
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  variant: ShapeCrossVariant = "plain",
): Segment[] {
  const { x, y, width, height } = rect;
  const bl = { x, y };
  const br = { x: x + width, y };
  const tr = { x: x + width, y: y + height };
  const tl = { x, y: y + height };
  const segments: Segment[] = [
    { a: bl, b: br },
    { a: br, b: tr },
    { a: tr, b: tl },
    { a: tl, b: bl },
  ];
  if (variant === "cross") {
    segments.push(...crossDiagonalSegments(rect));
  }
  return segments;
}

const CIRCLE_SNAP_SEGMENTS = 48;

function circleSegments(
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  variant: ShapeCrossVariant = "plain",
): Segment[] {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const segments: Segment[] = [];
  let prev: PdfPoint | null = null;
  const first: PdfPoint = {
    x: cx + rx,
    y: cy,
  };
  prev = first;
  for (let i = 1; i <= CIRCLE_SNAP_SEGMENTS; i++) {
    const t = (i / CIRCLE_SNAP_SEGMENTS) * 2 * Math.PI;
    const pt = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
    segments.push({ a: prev, b: pt });
    prev = pt;
  }
  if (variant === "cross") {
    segments.push(...ellipseCrossDiagonalSegments(rect));
  }
  return segments;
}

export function collectLineSegments(
  annotations: FloorPlanAnnotation[],
  draftPoints: PdfPoint[] = [],
): Segment[] {
  const segments: Segment[] = [];

  for (const item of annotations) {
    if (item.type === "polyline") {
      for (let i = 1; i < item.points.length; i++) {
        segments.push({ a: item.points[i - 1], b: item.points[i] });
      }
    } else if (item.type === "rectangle") {
      segments.push(
        ...rotateItemSegments(
          item,
          rectangleSegments(item.rect, item.variant),
        ),
      );
    } else if (item.type === "circle") {
      segments.push(
        ...rotateItemSegments(item, circleSegments(item.rect, item.variant)),
      );
    }
  }

  for (let i = 1; i < draftPoints.length; i++) {
    segments.push({ a: draftPoints[i - 1], b: draftPoints[i] });
  }

  return segments;
}

export function collectEndpoints(
  annotations: FloorPlanAnnotation[],
  draftPoints: PdfPoint[] = [],
): PdfPoint[] {
  const endpoints: PdfPoint[] = [];

  for (const item of annotations) {
    if (item.type === "polyline") {
      endpoints.push(...item.points);
    } else if (item.type === "rectangle") {
      const { x, y, width, height } = item.rect;
      endpoints.push(
        ...rotateItemPoints(item, [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ]),
      );
    } else if (item.type === "circle") {
      const { x, y, width, height } = item.rect;
      const cx = x + width / 2;
      const cy = y + height / 2;
      endpoints.push(
        ...rotateItemPoints(item, [
          { x: cx + width / 2, y: cy },
          { x: cx - width / 2, y: cy },
          { x: cx, y: cy + height / 2 },
          { x: cx, y: cy - height / 2 },
        ]),
      );
    }
  }

  endpoints.push(...draftPoints);
  return endpoints;
}

function collectSnapCandidates(
  raw: PdfPoint,
  annotations: FloorPlanAnnotation[],
  draftPoints: PdfPoint[],
  thresholdPt: number,
  options?: SnapOptions,
): SnapCandidate[] {
  const thresholdSq = thresholdPt * thresholdPt;
  const candidates: SnapCandidate[] = [];
  const endpoints = collectEndpoints(annotations, draftPoints);

  for (const endpoint of endpoints) {
    const dSq = distSq(raw, endpoint);
    if (dSq <= thresholdSq) {
      candidates.push({
        point: { ...endpoint },
        kind: "endpoint",
        distSq: dSq,
        priority: SNAP_PRIORITY.endpoint,
      });
    }
  }

  const segments = collectLineSegments(annotations, draftPoints);

  for (const segment of segments) {
    const onSegment = nearestPointOnSegment(raw, segment.a, segment.b);
    const onSegmentSq = distSq(raw, onSegment);
    if (onSegmentSq <= thresholdSq) {
      candidates.push({
        point: onSegment,
        kind: "on-line",
        distSq: onSegmentSq,
        priority: SNAP_PRIORITY["on-line"],
        segment,
      });
    }

    const onLine = nearestPointOnInfiniteLine(raw, segment.a, segment.b);
    const collinearSq = distSq(raw, onLine);
    if (!options?.disableExtensionSnaps && collinearSq <= thresholdSq) {
      candidates.push({
        point: onLine,
        kind: "collinear",
        distSq: collinearSq,
        priority: SNAP_PRIORITY.collinear,
        segment,
      });
    }
  }

  if (!options?.disableExtensionSnaps) {
  let bestAlignX: { ref: PdfPoint; distSq: number } | null = null;
  let bestAlignY: { ref: PdfPoint; distSq: number } | null = null;

  for (const endpoint of endpoints) {
    const dx = raw.x - endpoint.x;
    if (Math.abs(dx) <= thresholdPt) {
      const dSq = dx * dx;
      if (!bestAlignX || dSq < bestAlignX.distSq) {
        bestAlignX = { ref: endpoint, distSq: dSq };
      }
    }

    const dy = raw.y - endpoint.y;
    if (Math.abs(dy) <= thresholdPt) {
      const dSq = dy * dy;
      if (!bestAlignY || dSq < bestAlignY.distSq) {
        bestAlignY = { ref: endpoint, distSq: dSq };
      }
    }
  }

  if (bestAlignX || bestAlignY) {
    const point: PdfPoint = {
      x: bestAlignX ? bestAlignX.ref.x : raw.x,
      y: bestAlignY ? bestAlignY.ref.y : raw.y,
    };
    const kind = alignKind(Boolean(bestAlignX), Boolean(bestAlignY));
    candidates.push({
      point,
      kind,
      distSq: distSq(raw, point),
      priority: SNAP_PRIORITY[kind],
      alignXThrough: bestAlignX?.ref,
      alignYThrough: bestAlignY?.ref,
    });
  }
  }

  return candidates;
}

function reconcileSnapAfterOrtho(
  snapped: SnapResult,
  constrained: PdfPoint,
  thresholdPt: number,
): SnapResult {
  let alignXThrough = snapped.alignXThrough;
  let alignYThrough = snapped.alignYThrough;

  if (
    alignXThrough &&
    Math.abs(constrained.x - alignXThrough.x) > thresholdPt + EPS
  ) {
    alignXThrough = undefined;
  }
  if (
    alignYThrough &&
    Math.abs(constrained.y - alignYThrough.y) > thresholdPt + EPS
  ) {
    alignYThrough = undefined;
  }

  let kind = snapped.kind;
  if (
    kind === "align-x" ||
    kind === "align-y" ||
    kind === "align-xy"
  ) {
    if (alignXThrough && alignYThrough) kind = "align-xy";
    else if (alignXThrough) kind = "align-x";
    else if (alignYThrough) kind = "align-y";
    else kind = null;
  }

  return {
    ...snapped,
    point: constrained,
    kind,
    alignXThrough,
    alignYThrough,
  };
}

/**
 * Snap `raw` to the nearest snap target within `thresholdPt`.
 * Priority: endpoint → on-line → collinear → axis alignment.
 */
export function snapPoint(
  raw: PdfPoint,
  annotations: FloorPlanAnnotation[],
  draftPoints: PdfPoint[],
  thresholdPt: number,
  options?: SnapOptions,
): SnapResult {
  const best = pickBestCandidate(
    collectSnapCandidates(raw, annotations, draftPoints, thresholdPt, options),
  );
  if (best) return best;
  return { point: raw, kind: null };
}

export function resolveLineCursor(
  raw: PdfPoint,
  anchor: PdfPoint | null,
  shiftHeld: boolean,
  annotations: FloorPlanAnnotation[],
  draftPoints: PdfPoint[],
  thresholdPt: number,
  options?: SnapOptions,
): SnapResult {
  const snapped = snapPoint(
    raw,
    annotations,
    draftPoints,
    thresholdPt,
    options,
  );
  if (shiftHeld && anchor) {
    const constrained = constrainToOrthoDiagonal(anchor, snapped.point);
    return reconcileSnapAfterOrtho(snapped, constrained, thresholdPt);
  }
  return snapped;
}

/** Screen-pixel snap radius → PDF points for the current view scale. */
export function snapThresholdPt(
  screenPx: number,
  layoutScale: number,
  zoom = 1,
): number {
  const cssPerPt = layoutScale * zoom;
  return cssPerPt > EPS ? screenPx / cssPerPt : screenPx;
}

/** One screen pixel → PDF-point delta for the current view scale. */
export function pdfDeltaPerScreenPixel(
  layoutScale: number,
  zoom = 1,
): number {
  const cssPerPt = layoutScale * zoom;
  return cssPerPt > EPS ? 1 / cssPerPt : 1;
}

function annotationSegments(item: FloorPlanAnnotation): Segment[] {
  if (item.type === "polyline") {
    const segments: Segment[] = [];
    for (let i = 1; i < item.points.length; i++) {
      segments.push({ a: item.points[i - 1], b: item.points[i] });
    }
    return segments;
  }
  if (item.type === "room") {
    const segments: Segment[] = [];
    const points = item.points;
    for (let i = 0; i < points.length; i++) {
      segments.push({
        a: points[i]!,
        b: points[(i + 1) % points.length]!,
      });
    }
    return segments;
  }
  if (item.type === "circle") {
    return rotateItemSegments(item, circleSegments(item.rect, item.variant));
  }
  return rotateItemSegments(
    item,
    rectangleSegments(item.rect, item.variant),
  );
}

function annotationHit(
  point: PdfPoint,
  item: FloorPlanAnnotation,
  thresholdSq: number,
): boolean {
  if (item.type === "room" && pointInPolygon(point, item.points)) return true;
  for (const segment of annotationSegments(item)) {
    const nearest = nearestPointOnSegment(point, segment.a, segment.b);
    if (distSq(point, nearest) <= thresholdSq) return true;
  }
  return false;
}

/** Index of the topmost annotation under `point`, or null. */
export function hitTestAnnotations(
  point: PdfPoint,
  annotations: FloorPlanAnnotation[],
  thresholdPt: number,
): number | null {
  const thresholdSq = thresholdPt * thresholdPt;
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (annotationHit(point, annotations[i], thresholdSq)) return i;
  }
  return null;
}

/** Convert a constant screen-pixel size to page-canvas SVG units. */
export function screenPxToCanvasUnits(screenPx: number, zoom = 1): number {
  return zoom > EPS ? screenPx / zoom : screenPx;
}

/** Cursor reference for orienting on-line / collinear snap markers. */
export function snapApproachFrom(
  kind: SnapKind | null | undefined,
  raw: PdfPoint,
): PdfPoint | undefined {
  if (kind === "on-line" || kind === "collinear") return raw;
  return undefined;
}

/** Whether this snap kind should show infinite extension / alignment guides. */
export function snapShowsExtensionGuides(kind: SnapKind | null | undefined): boolean {
  return (
    kind === "collinear" ||
    kind === "align-x" ||
    kind === "align-y" ||
    kind === "align-xy"
  );
}

/** Topmost polyline vertex within `thresholdPt`, or null. */
export function hitTestVertex(
  raw: PdfPoint,
  annotations: FloorPlanAnnotation[],
  thresholdPt: number,
): { annotationIndex: number; pointIndex: number } | null {
  const thresholdSq = thresholdPt * thresholdPt;
  for (let i = annotations.length - 1; i >= 0; i--) {
    const item = annotations[i];
    if (item.type !== "polyline") continue;
    for (let j = 0; j < item.points.length; j++) {
      if (distSq(raw, item.points[j]) <= thresholdSq) {
        return { annotationIndex: i, pointIndex: j };
      }
    }
  }
  return null;
}

/** Snap sources with one annotation omitted (avoids self-snapping while dragging). */
export function annotationsExcludingIndex(
  annotations: FloorPlanAnnotation[],
  excludeIndex: number,
): FloorPlanAnnotation[] {
  return annotations.filter((_, i) => i !== excludeIndex);
}

/** Ortho anchor for dragging `pointIndex` on a polyline. */
export function vertexDragAnchor(
  points: PdfPoint[],
  pointIndex: number,
): PdfPoint | null {
  if (points.length < 2) return null;
  if (pointIndex > 0) return points[pointIndex - 1];
  return points[pointIndex + 1];
}
