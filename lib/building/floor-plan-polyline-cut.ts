/** Cut / sever operations on floor-plan polyline markup. */

import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import { nearestPointOnSegment } from "@/lib/building/floor-plan-draw-snap";

const EPS = 1e-6;

export type PolylineCutLocation = {
  segmentIndex: number;
  t: number;
  point: PdfPoint;
};

function distSq(a: PdfPoint, b: PdfPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function pointsNear(a: PdfPoint, b: PdfPoint, eps = EPS): boolean {
  return distSq(a, b) <= eps * eps;
}

export function positionAlongPolyline(loc: PolylineCutLocation): number {
  return loc.segmentIndex + loc.t;
}

export function rectangleToPolylinePoints(rect: PdfRect): PdfPoint[] {
  const { x, y, width, height } = rect;
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

const CIRCLE_POLYLINE_SEGMENTS = 48;

/** Polygon approximation of an ellipse inscribed in `rect`. */
export function circleToPolylinePoints(rect: PdfRect): PdfPoint[] {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const points: PdfPoint[] = [];
  for (let i = 0; i < CIRCLE_POLYLINE_SEGMENTS; i++) {
    const t = (i / CIRCLE_POLYLINE_SEGMENTS) * 2 * Math.PI;
    points.push({
      x: cx + rx * Math.cos(t),
      y: cy + ry * Math.sin(t),
    });
  }
  return points;
}

/** Point on an ellipse boundary along the ray from its center at `angle` (radians). */
export function pointOnEllipseBoundary(
  rect: PdfRect,
  angle: number,
): PdfPoint {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const denom = (cos * cos) / (rx * rx) + (sin * sin) / (ry * ry);
  const scale = denom > 0 ? 1 / Math.sqrt(denom) : 0;
  return { x: cx + cos * scale, y: cy + sin * scale };
}

/** Two diagonals of an ellipse, fully inside the perimeter (for cross variant). */
export function ellipseCrossDiagonalSegments(rect: PdfRect): {
  a: PdfPoint;
  b: PdfPoint;
}[] {
  const a1 = pointOnEllipseBoundary(rect, Math.PI / 4);
  const a2 = pointOnEllipseBoundary(rect, Math.PI / 4 + Math.PI);
  const b1 = pointOnEllipseBoundary(rect, (3 * Math.PI) / 4);
  const b2 = pointOnEllipseBoundary(rect, (3 * Math.PI) / 4 + Math.PI);
  return [
    { a: a1, b: a2 },
    { a: b1, b: b2 },
  ];
}

/** Nearest point on a polyline within `thresholdPt`. Endpoints win over on-line. */
export function locatePointOnPolyline(
  points: PdfPoint[],
  raw: PdfPoint,
  thresholdPt: number,
): PolylineCutLocation | null {
  if (points.length < 2) return null;

  const thresholdSq = thresholdPt * thresholdPt;

  for (let i = 0; i < points.length; i++) {
    if (distSq(raw, points[i]) <= thresholdSq) {
      if (i === points.length - 1) {
        return {
          segmentIndex: points.length - 2,
          t: 1,
          point: { ...points[i] },
        };
      }
      return {
        segmentIndex: i,
        t: 0,
        point: { ...points[i] },
      };
    }
  }

  let best: PolylineCutLocation | null = null;
  let bestSq = thresholdSq;

  for (let i = 0; i < points.length - 1; i++) {
    const nearest = nearestPointOnSegment(raw, points[i], points[i + 1]);
    const dSq = distSq(raw, nearest);
    if (dSq > bestSq) continue;

    const abx = points[i + 1].x - points[i].x;
    const aby = points[i + 1].y - points[i].y;
    const lenSq = abx * abx + aby * aby;
    const t =
      lenSq < EPS
        ? 0
        : ((nearest.x - points[i].x) * abx + (nearest.y - points[i].y) * aby) /
          lenSq;

    bestSq = dSq;
    best = { segmentIndex: i, t, point: nearest };
  }

  return best;
}

function pushDistinct(points: PdfPoint[], point: PdfPoint): number {
  if (points.length > 0 && pointsNear(points[points.length - 1], point)) {
    return points.length - 1;
  }
  points.push({ ...point });
  return points.length - 1;
}

function resolveVertexIndex(
  points: PdfPoint[],
  loc: PolylineCutLocation,
  expanded: PdfPoint[],
): number {
  const seg = loc.segmentIndex;
  const vertexAtStart = points[seg];
  const vertexAtEnd = points[seg + 1];

  if (loc.t <= EPS || pointsNear(loc.point, vertexAtStart)) {
    for (let i = 0; i < expanded.length; i++) {
      if (pointsNear(expanded[i], vertexAtStart)) return i;
    }
  }

  if (loc.t >= 1 - EPS || pointsNear(loc.point, vertexAtEnd)) {
    for (let i = expanded.length - 1; i >= 0; i--) {
      if (pointsNear(expanded[i], vertexAtEnd)) return i;
    }
  }

  for (let i = 0; i < expanded.length; i++) {
    if (pointsNear(expanded[i], loc.point)) return i;
  }

  return pushDistinct(expanded, loc.point);
}

/**
 * Insert cut locations into a copy of `points` and return vertex indices for each cut.
 * `locA` and `locB` are reordered when needed.
 */
export function materializePolylineCuts(
  points: PdfPoint[],
  locA: PolylineCutLocation,
  locB: PolylineCutLocation,
): { points: PdfPoint[]; indexA: number; indexB: number } | null {
  if (points.length < 2) return null;

  let first = locA;
  let second = locB;
  if (positionAlongPolyline(first) > positionAlongPolyline(second)) {
    first = second;
    second = locA;
  }

  if (positionAlongPolyline(second) - positionAlongPolyline(first) < EPS) {
    return null;
  }

  const expanded: PdfPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    pushDistinct(expanded, points[i]);

    if (i < points.length - 1) {
      const cutsOnSegment: PolylineCutLocation[] = [];
      if (first.segmentIndex === i) cutsOnSegment.push(first);
      if (second.segmentIndex === i) cutsOnSegment.push(second);

      cutsOnSegment.sort(
        (a, b) => positionAlongPolyline(a) - positionAlongPolyline(b),
      );

      for (const cut of cutsOnSegment) {
        const atStart =
          cut.t <= EPS || pointsNear(cut.point, points[i]);
        const atEnd =
          cut.t >= 1 - EPS || pointsNear(cut.point, points[i + 1]);
        if (!atStart && !atEnd) {
          pushDistinct(expanded, cut.point);
        }
      }
    }
  }

  const indexA = resolveVertexIndex(points, locA, expanded);
  const indexB = resolveVertexIndex(points, locB, expanded);

  if (indexA === indexB) return null;

  const orderedFirst =
    positionAlongPolyline(locA) <= positionAlongPolyline(locB)
      ? indexA
      : indexB;
  const orderedSecond =
    positionAlongPolyline(locA) <= positionAlongPolyline(locB)
      ? indexB
      : indexA;

  return { points: expanded, indexA: orderedFirst, indexB: orderedSecond };
}

/**
 * Remove the portion between two cut locations. Returns zero, one, or two polylines
 * (each with at least two vertices when included).
 */
export function cutPolylineBetweenLocations(
  points: PdfPoint[],
  locA: PolylineCutLocation,
  locB: PolylineCutLocation,
): PdfPoint[][] {
  const materialized = materializePolylineCuts(points, locA, locB);
  if (!materialized) return [];

  const { points: expanded, indexA, indexB } = materialized;
  const before = expanded.slice(0, indexA + 1);
  const after = expanded.slice(indexB);

  const result: PdfPoint[][] = [];
  if (before.length >= 2) result.push(before);
  if (after.length >= 2) result.push(after);
  return result;
}
