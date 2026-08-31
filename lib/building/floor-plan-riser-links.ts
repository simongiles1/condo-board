/** Riser-offset pairs: two boxes, one of which continues to the floor above (ABV). */

import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import type {
  FloorPlanAnnotation,
  FloorPlanCircleAnnotation,
  FloorPlanRectangleAnnotation,
} from "@/lib/building/floor-plan-annotations";

export type ConnectableBox =
  | FloorPlanRectangleAnnotation
  | FloorPlanCircleAnnotation;

export type RiserPair = {
  aboveIndex: number;
  belowIndex: number;
  above: ConnectableBox;
  below: ConnectableBox;
};

export function isConnectableBox(
  item: FloorPlanAnnotation | undefined,
): item is ConnectableBox {
  return item != null && (item.type === "rectangle" || item.type === "circle");
}

export function boxCenter(item: ConnectableBox): PdfPoint {
  return {
    x: item.rect.x + item.rect.width / 2,
    y: item.rect.y + item.rect.height / 2,
  };
}

export function newAnnotationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `box-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function stripRiserLink(item: ConnectableBox): ConnectableBox {
  const next: ConnectableBox = {
    type: item.type,
    rect: item.rect,
    color: item.color,
    strokeWidthPt: item.strokeWidthPt,
  };
  if (item.variant === "cross") next.variant = "cross";
  return next;
}

function pointInRect(point: PdfPoint, rect: PdfRect, pad: number): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad
  );
}

function pointInEllipse(point: PdfPoint, rect: PdfRect, pad: number): boolean {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2 + pad;
  const ry = rect.height / 2 + pad;
  if (rx <= 0 || ry <= 0) return false;
  const nx = (point.x - cx) / rx;
  const ny = (point.y - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

export function pointHitsConnectableBox(
  point: PdfPoint,
  item: ConnectableBox,
  padPt: number,
): boolean {
  if (item.type === "circle") return pointInEllipse(point, item.rect, padPt);
  return pointInRect(point, item.rect, padPt);
}

/** Topmost rectangle or circle under `point`, or null. */
export function hitTestConnectableBox(
  point: PdfPoint,
  annotations: FloorPlanAnnotation[],
  padPt: number,
): number | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const item = annotations[i];
    if (isConnectableBox(item) && pointHitsConnectableBox(point, item, padPt)) {
      return i;
    }
  }
  return null;
}

function rayExitRect(
  center: PdfPoint,
  toward: PdfPoint,
  rect: PdfRect,
): PdfPoint {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  if (hw <= 0 || hh <= 0) return center;
  const tx = Math.abs(dx) < 1e-9 ? Infinity : hw / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-9 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);
  if (!Number.isFinite(t)) return center;
  return { x: center.x + dx * t, y: center.y + dy * t };
}

function rayExitEllipse(
  center: PdfPoint,
  toward: PdfPoint,
  rect: PdfRect,
): PdfPoint {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (rx <= 0 || ry <= 0) return center;
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const a = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (a < 1e-12) return center;
  const t = 1 / Math.sqrt(a);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

function boxEdgeToward(
  item: ConnectableBox,
  toward: PdfPoint,
): PdfPoint {
  const center = boxCenter(item);
  return item.type === "circle"
    ? rayExitEllipse(center, toward, item.rect)
    : rayExitRect(center, toward, item.rect);
}

/** Arrow from the above (ABV) box border to the lower box border. */
export function riserArrowEndpoints(
  from: ConnectableBox,
  to: ConnectableBox,
): { start: PdfPoint; end: PdfPoint } | null {
  const a = boxCenter(from);
  const b = boxCenter(to);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return null;
  return {
    start: boxEdgeToward(from, b),
    end: boxEdgeToward(to, a),
  };
}

export function listRiserPairs(
  annotations: FloorPlanAnnotation[],
): RiserPair[] {
  const byId = new Map<string, number>();
  for (let i = 0; i < annotations.length; i++) {
    const item = annotations[i];
    if (isConnectableBox(item) && item.id) byId.set(item.id, i);
  }

  const pairs: RiserPair[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < annotations.length; i++) {
    const item = annotations[i];
    if (
      !isConnectableBox(item) ||
      item.riserRole !== "above" ||
      !item.id ||
      !item.riserPartnerId ||
      seen.has(item.id)
    ) {
      continue;
    }
    const belowIndex = byId.get(item.riserPartnerId);
    if (belowIndex == null) continue;
    const below = annotations[belowIndex];
    if (
      !isConnectableBox(below) ||
      below.riserRole !== "below" ||
      below.riserPartnerId !== item.id
    ) {
      continue;
    }
    seen.add(item.id);
    pairs.push({ aboveIndex: i, belowIndex, above: item, below });
  }
  return pairs;
}

export function clearDanglingRiserLinks(
  annotations: FloorPlanAnnotation[],
): FloorPlanAnnotation[] {
  const validAboveIds = new Set(
    listRiserPairs(annotations).map((pair) => pair.above.id as string),
  );
  return annotations.map((item) => {
    if (!isConnectableBox(item)) return item;
    if (!item.riserRole) return item;
    if (item.riserRole === "above" && item.id && validAboveIds.has(item.id)) {
      return item;
    }
    if (
      item.riserRole === "below" &&
      item.riserPartnerId &&
      validAboveIds.has(item.riserPartnerId)
    ) {
      return item;
    }
    return stripRiserLink(item);
  });
}

/**
 * Markup to pin-map onto a higher floor: unpaired boxes stay, the ABV box of
 * each pair stays (unlinked), and the lower box is dropped.
 */
export function annotationsForHigherFloor(
  annotations: FloorPlanAnnotation[],
): FloorPlanAnnotation[] {
  const dropIds = new Set(
    listRiserPairs(annotations).map((pair) => pair.below.id as string),
  );
  return annotations.flatMap((item) => {
    if (!isConnectableBox(item)) return [item];
    if (item.id && dropIds.has(item.id)) return [];
    if (item.riserRole || item.riserPartnerId || item.id) {
      return [stripRiserLink(item)];
    }
    return [item];
  });
}

function linkedToIds(item: ConnectableBox, ids: Set<string>): boolean {
  return Boolean(
    (item.id && ids.has(item.id)) ||
      (item.riserPartnerId && ids.has(item.riserPartnerId)),
  );
}

export function disconnectRiserBox(
  annotations: FloorPlanAnnotation[],
  index: number,
): FloorPlanAnnotation[] {
  const item = annotations[index];
  if (!isConnectableBox(item) || !item.riserRole) return annotations;
  const ids = new Set<string>();
  if (item.id) ids.add(item.id);
  if (item.riserPartnerId) ids.add(item.riserPartnerId);
  if (ids.size === 0) return annotations;
  return annotations.map((entry) =>
    isConnectableBox(entry) && linkedToIds(entry, ids)
      ? stripRiserLink(entry)
      : entry,
  );
}

export function connectRiserBoxes(
  annotations: FloorPlanAnnotation[],
  aboveIndex: number,
  belowIndex: number,
): FloorPlanAnnotation[] | null {
  if (aboveIndex === belowIndex) return null;
  const above = annotations[aboveIndex];
  const below = annotations[belowIndex];
  if (!isConnectableBox(above) || !isConnectableBox(below)) return null;

  if (
    above.riserRole === "above" &&
    below.riserRole === "below" &&
    above.id &&
    below.id &&
    above.riserPartnerId === below.id &&
    below.riserPartnerId === above.id
  ) {
    return annotations;
  }

  const aboveId = above.id ?? newAnnotationId();
  let belowId = below.id ?? newAnnotationId();
  if (belowId === aboveId) belowId = newAnnotationId();

  const idsToClear = new Set<string>([aboveId, belowId]);
  if (above.riserPartnerId) idsToClear.add(above.riserPartnerId);
  if (below.riserPartnerId) idsToClear.add(below.riserPartnerId);

  return annotations.map((item, i) => {
    if (i === aboveIndex) {
      return {
        ...above,
        id: aboveId,
        riserPartnerId: belowId,
        riserRole: "above" as const,
      };
    }
    if (i === belowIndex) {
      return {
        ...below,
        id: belowId,
        riserPartnerId: aboveId,
        riserRole: "below" as const,
      };
    }
    if (isConnectableBox(item) && linkedToIds(item, idsToClear)) {
      return stripRiserLink(item);
    }
    return item;
  });
}
