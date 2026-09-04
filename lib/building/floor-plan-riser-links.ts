/** Riser-offset pairs: one or more arrows between ABV boxes and a lower box. */

import type { PdfPoint, PdfRect } from "@/lib/building/floor-plan-align";
import { duplicateCallout } from "@/lib/building/floor-plan-callouts";
import { nearestPointOnSegment } from "@/lib/building/floor-plan-draw-snap";
import {
  annotationRotationDeg,
  rotatePdfPointAround,
  withAnnotationRotation,
  type FloorPlanAnnotation,
  type FloorPlanCallout,
  type FloorPlanCircleAnnotation,
  type FloorPlanRectangleAnnotation,
} from "@/lib/building/floor-plan-annotations";
import {
  calloutRiserIds,
  narrowCalloutToRisers,
  type MechanicalRiserDto,
  type MechanicalRiserTypeDto,
} from "@/lib/building/floor-plan-mechanical-risers";

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
  if (item.filled) next.filled = true;
  if (item.callout) next.callout = item.callout;
  if (item.markupSet === 2) next.markupSet = 2;
  const rotationDeg = annotationRotationDeg(item);
  if (rotationDeg !== 0) next.rotationDeg = rotationDeg;
  return next;
}

/** Opposite-role partners on a linked box (`riserPartnerIds`, else `riserPartnerId`). */
export function riserPartnerIds(item: ConnectableBox): string[] {
  if (item.riserPartnerIds && item.riserPartnerIds.length > 0) {
    return item.riserPartnerIds;
  }
  return item.riserPartnerId ? [item.riserPartnerId] : [];
}

function uniquePartnerIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

function applyRiserLink(
  item: ConnectableBox,
  id: string,
  partnerIds: string[],
  role: "above" | "below",
): ConnectableBox {
  const unique = uniquePartnerIds(partnerIds);
  if (unique.length === 0) return stripRiserLink(item);
  const next: ConnectableBox = {
    ...stripRiserLink(item),
    id,
    riserPartnerId: unique[0],
    riserRole: role,
  };
  if (item.callout) next.callout = item.callout;
  if (unique.length > 1) next.riserPartnerIds = unique;
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
  const deg = annotationRotationDeg(item);
  const local =
    deg === 0
      ? point
      : rotatePdfPointAround(point, boxCenter(item), -deg);
  if (item.type === "circle") return pointInEllipse(local, item.rect, padPt);
  return pointInRect(local, item.rect, padPt);
}

/** Topmost rectangle or circle under `point`, or null. */
export function hitTestConnectableBox(
  point: PdfPoint,
  annotations: FloorPlanAnnotation[],
  padPt: number,
  isVisible?: (item: FloorPlanAnnotation, index: number) => boolean,
): number | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const item = annotations[i];
    if (isVisible && !isVisible(item, i)) continue;
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

export function boxEdgeToward(
  item: ConnectableBox,
  toward: PdfPoint,
): PdfPoint {
  const center = boxCenter(item);
  const deg = annotationRotationDeg(item);
  const localToward =
    deg === 0 ? toward : rotatePdfPointAround(toward, center, -deg);
  const localExit =
    item.type === "circle"
      ? rayExitEllipse(center, localToward, item.rect)
      : rayExitRect(center, localToward, item.rect);
  return deg === 0
    ? localExit
    : rotatePdfPointAround(localExit, center, deg);
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
    if (!isConnectableBox(item) || item.riserRole !== "above" || !item.id) {
      continue;
    }
    for (const partnerId of riserPartnerIds(item)) {
      const pairKey = `${item.id}:${partnerId}`;
      if (seen.has(pairKey)) continue;
      const belowIndex = byId.get(partnerId);
      if (belowIndex == null) continue;
      const below = annotations[belowIndex];
      if (
        !isConnectableBox(below) ||
        below.riserRole !== "below" ||
        !below.id ||
        !riserPartnerIds(below).includes(item.id)
      ) {
        continue;
      }
      seen.add(pairKey);
      pairs.push({ aboveIndex: i, belowIndex, above: item, below });
    }
  }
  return pairs;
}

export function clearDanglingRiserLinks(
  annotations: FloorPlanAnnotation[],
): FloorPlanAnnotation[] {
  const partnersById = new Map<string, string[]>();
  const roleById = new Map<string, "above" | "below">();
  for (const pair of listRiserPairs(annotations)) {
    const aboveId = pair.above.id;
    const belowId = pair.below.id;
    if (!aboveId || !belowId) continue;
    roleById.set(aboveId, "above");
    roleById.set(belowId, "below");
    const abovePartners = partnersById.get(aboveId) ?? [];
    if (!abovePartners.includes(belowId)) abovePartners.push(belowId);
    partnersById.set(aboveId, abovePartners);
    const belowPartners = partnersById.get(belowId) ?? [];
    if (!belowPartners.includes(aboveId)) belowPartners.push(aboveId);
    partnersById.set(belowId, belowPartners);
  }
  return annotations.map((item) => {
    if (!isConnectableBox(item) || !item.riserRole || !item.id) return item;
    const partners = partnersById.get(item.id);
    const role = roleById.get(item.id);
    if (!partners || !role) return stripRiserLink(item);
    return applyRiserLink(item, item.id, partners, role);
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
    if (item.riserRole || item.riserPartnerId || item.riserPartnerIds || item.id) {
      return [stripRiserLink(item)];
    }
    return [item];
  });
}

function dropPartner(
  item: ConnectableBox,
  partnerId: string,
): ConnectableBox {
  if (!item.id || !item.riserRole) return stripRiserLink(item);
  return applyRiserLink(
    item,
    item.id,
    riserPartnerIds(item).filter((id) => id !== partnerId),
    item.riserRole,
  );
}

export function disconnectRiserBox(
  annotations: FloorPlanAnnotation[],
  index: number,
): FloorPlanAnnotation[] {
  const item = annotations[index];
  if (!isConnectableBox(item) || !item.riserRole || !item.id) {
    return annotations;
  }
  const droppedId = item.id;
  const partners = new Set(riserPartnerIds(item));
  if (partners.size === 0) return annotations;
  return annotations.map((entry) => {
    if (!isConnectableBox(entry)) return entry;
    if (entry.id === droppedId) return stripRiserLink(entry);
    if (entry.id && partners.has(entry.id)) {
      return dropPartner(entry, droppedId);
    }
    return entry;
  });
}

function pointNearSegment(
  point: PdfPoint,
  a: PdfPoint,
  b: PdfPoint,
  thresholdSq: number,
): boolean {
  const nearest = nearestPointOnSegment(point, a, b);
  const dx = point.x - nearest.x;
  const dy = point.y - nearest.y;
  return dx * dx + dy * dy <= thresholdSq;
}

/** Topmost riser connection arrow under `point`, identified by the above box id. */
export function hitTestRiserPair(
  point: PdfPoint,
  annotations: FloorPlanAnnotation[],
  thresholdPt: number,
): string | null {
  const thresholdSq = thresholdPt * thresholdPt;
  const pairs = listRiserPairs(annotations);
  for (let i = pairs.length - 1; i >= 0; i--) {
    const pair = pairs[i];
    const ends = riserArrowEndpoints(pair.above, pair.below);
    if (!ends) continue;
    if (pointNearSegment(point, ends.start, ends.end, thresholdSq)) {
      return pair.above.id ?? null;
    }
  }
  return null;
}

/** Swap which box is marked above (ABV) vs below for an existing pair. */
export function reverseRiserPair(
  annotations: FloorPlanAnnotation[],
  aboveIndex: number,
  belowIndex: number,
): FloorPlanAnnotation[] | null {
  if (aboveIndex === belowIndex) return null;
  const above = annotations[aboveIndex];
  const below = annotations[belowIndex];
  if (!isConnectableBox(above) || !isConnectableBox(below)) return null;
  if (
    above.riserRole !== "above" ||
    below.riserRole !== "below" ||
    !above.id ||
    !below.id ||
    !riserPartnerIds(above).includes(below.id) ||
    !riserPartnerIds(below).includes(above.id) ||
    riserPartnerIds(above).length !== 1 ||
    riserPartnerIds(below).length !== 1
  ) {
    return null;
  }

  return annotations.map((item, i) => {
    if (i === aboveIndex) {
      return { ...above, riserRole: "below" as const };
    }
    if (i === belowIndex) {
      return { ...below, riserRole: "above" as const };
    }
    return item;
  });
}

export type ConnectRiserBoxesOptions = {
  /** Subset of the source callout's catalog ids to copy onto the unlabeled partner. */
  copyRiserIds?: string[];
  types?: MechanicalRiserTypeDto[];
  risers?: MechanicalRiserDto[];
};

export type ConnectPlaceDraft = {
  kind: "annotation" | "overlay";
  index: number;
  center: PdfPoint;
};

export type ConnectRiserChoice = {
  riserIds: string[];
  aboveIndex?: number;
  belowIndex?: number;
  place?: ConnectPlaceDraft;
};

/**
 * Same-size copy of `source`, centered on `center`, with no callout or link.
 * Used so Connection can pair it as ABV and copy tags from the from-below box.
 */
export function unlabeledBoxCenteredOn(
  source: ConnectableBox,
  center: PdfPoint,
): ConnectableBox {
  const placed: ConnectableBox = {
    type: source.type,
    rect: {
      x: center.x - source.rect.width / 2,
      y: center.y - source.rect.height / 2,
      width: source.rect.width,
      height: source.rect.height,
    },
    color: source.color,
    strokeWidthPt: source.strokeWidthPt,
  };
  if (source.variant === "cross") placed.variant = "cross";
  if (source.markupSet === 2) placed.markupSet = 2;
  return withAnnotationRotation(placed, annotationRotationDeg(source));
}

/**
 * Same-size copy of `source`, centered on `center`, with no riser-offset link.
 * Copies the callout (or a chosen subset) so follow-mode visibility still works.
 */
export function placeRiserBoxFromSource(
  source: ConnectableBox,
  center: PdfPoint,
  options?: ConnectRiserBoxesOptions,
): ConnectableBox {
  const placed = unlabeledBoxCenteredOn(source, center);
  if (source.callout) {
    const copied = calloutForConnectCopy(source.callout, placed, options);
    if (copied) placed.callout = copied;
  }
  return placed;
}

/**
 * Place a new ABV box at `center` and pair it with the from-below source.
 * `sourceIndex` is the saved box; omit it to write an overlay onto this floor
 * as the below partner. Arrow points at the existing (not-ABV) riser.
 */
export function placeAndConnectRiserBox(
  annotations: FloorPlanAnnotation[],
  source: ConnectableBox,
  center: PdfPoint,
  sourceIndex: number | null,
  options?: ConnectRiserBoxesOptions,
): FloorPlanAnnotation[] | null {
  const above = unlabeledBoxCenteredOn(source, center);
  let next: FloorPlanAnnotation[];
  let belowIndex: number;
  if (sourceIndex == null) {
    next = [...annotations, stripRiserLink(source), above];
    belowIndex = next.length - 2;
  } else {
    next = [...annotations, above];
    belowIndex = sourceIndex;
  }
  return connectRiserBoxes(next, next.length - 1, belowIndex, options);
}

/** Callout that would be copied when only one of the two boxes is labeled. */
export function calloutCopiedOnConnect(
  above: ConnectableBox,
  below: ConnectableBox,
): FloorPlanCallout | null {
  if (above.callout && !below.callout) return above.callout;
  if (below.callout && !above.callout) return below.callout;
  return null;
}

export function connectNeedsRiserChoice(callout: FloorPlanCallout): boolean {
  return calloutRiserIds(callout).length > 1;
}

function calloutForConnectCopy(
  source: FloorPlanCallout,
  target: ConnectableBox,
  options?: ConnectRiserBoxesOptions,
): FloorPlanCallout | null {
  const requested = options?.copyRiserIds;
  if (requested == null) return duplicateCallout(source, target);
  const allowed = new Set(calloutRiserIds(source));
  const chosen = requested.filter((id) => allowed.has(id));
  if (chosen.length === 0) return null;
  return duplicateCallout(
    narrowCalloutToRisers(
      source,
      chosen,
      options.types ?? [],
      options.risers ?? [],
    ),
    target,
  );
}

export function connectRiserBoxes(
  annotations: FloorPlanAnnotation[],
  aboveIndex: number,
  belowIndex: number,
  options?: ConnectRiserBoxesOptions,
): FloorPlanAnnotation[] | null {
  if (aboveIndex === belowIndex) return null;
  const first = annotations[aboveIndex];
  const second = annotations[belowIndex];
  if (!isConnectableBox(first) || !isConnectableBox(second)) return null;

  if (
    first.id &&
    second.id &&
    riserPartnerIds(first).includes(second.id) &&
    riserPartnerIds(second).includes(first.id)
  ) {
    return annotations;
  }

  let resolvedAboveIndex = aboveIndex;
  let resolvedBelowIndex = belowIndex;
  if (first.riserRole === "below" && !second.riserRole) {
    resolvedAboveIndex = belowIndex;
    resolvedBelowIndex = aboveIndex;
  } else if (second.riserRole === "above" && !first.riserRole) {
    resolvedAboveIndex = belowIndex;
    resolvedBelowIndex = aboveIndex;
  }

  const above = annotations[resolvedAboveIndex];
  const below = annotations[resolvedBelowIndex];
  if (!isConnectableBox(above) || !isConnectableBox(below)) return null;

  const aboveId = above.id ?? newAnnotationId();
  let belowId = below.id ?? newAnnotationId();
  if (belowId === aboveId) belowId = newAnnotationId();

  const roleFlipIds = new Set<string>();
  if (above.riserRole === "below") {
    for (const id of riserPartnerIds(above)) roleFlipIds.add(id);
  }
  if (below.riserRole === "above") {
    for (const id of riserPartnerIds(below)) roleFlipIds.add(id);
  }

  const abovePartners =
    above.riserRole === "below" ? [] : [...riserPartnerIds(above)];
  if (!abovePartners.includes(belowId)) abovePartners.push(belowId);
  const belowPartners =
    below.riserRole === "above" ? [] : [...riserPartnerIds(below)];
  if (!belowPartners.includes(aboveId)) belowPartners.push(aboveId);

  let linkedAbove = applyRiserLink(above, aboveId, abovePartners, "above");
  let linkedBelow = applyRiserLink(below, belowId, belowPartners, "below");
  if (linkedAbove.callout && !linkedBelow.callout) {
    const copied = calloutForConnectCopy(
      linkedAbove.callout,
      linkedBelow,
      options,
    );
    if (copied) linkedBelow = { ...linkedBelow, callout: copied };
  } else if (linkedBelow.callout && !linkedAbove.callout) {
    const copied = calloutForConnectCopy(
      linkedBelow.callout,
      linkedAbove,
      options,
    );
    if (copied) linkedAbove = { ...linkedAbove, callout: copied };
  }

  return annotations.map((item, i) => {
    if (i === resolvedAboveIndex) {
      return linkedAbove;
    }
    if (i === resolvedBelowIndex) {
      return linkedBelow;
    }
    if (
      isConnectableBox(item) &&
      item.id &&
      roleFlipIds.has(item.id)
    ) {
      return dropPartner(item, item.riserRole === "above" ? aboveId : belowId);
    }
    return item;
  });
}
