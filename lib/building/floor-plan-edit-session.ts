/**
 * Edit-mode ribbon + view. Ribbon settings persist in localStorage across page
 * loads; both survive FloorPlanCropEditor remounting when the selected drawing
 * changes (`key={plan.id}`).
 *
 * Do not read localStorage from {@link readFloorPlanEditRibbonSession}: that
 * runs during SSR and the first client render. A stored color there makes
 * ColorDropdown hydrate with a different label than the server HTML. Call
 * {@link hydrateFloorPlanEditRibbonFromStorage} from a layout effect after
 * mount, then apply the snapshot to React state.
 *
 * Mechanical annotation loading must wait for that hydrate (and must write
 * `markupSet` onto the ref in the same layout effect). The SSR default is
 * Pass 1; loading before hydrate shows Pass 1 unlabeled boxes while the
 * ribbon already says Pass 2.
 */

import type { PinRelativeView } from "@/lib/building/floor-plan-align";
import {
  DRAW_COLORS,
  STROKE_WIDTHS_PT,
  parseMechanicalMarkupSet,
  type DrawTool,
  type MechanicalMarkupSet,
  type ShapeCrossVariant,
  type StrokeColorFilter,
} from "@/lib/building/floor-plan-annotations";

const DRAW_TOOLS: readonly DrawTool[] = [
  "none",
  "line",
  "rectangle",
  "circle",
  "room",
  "cut",
  "connect",
  "callout",
  "rotate",
];

export type FloorPlanFollowSkip = {
  planId: string;
  riserId: string;
};

/** This-floor-only nudge of a followed overlay before it is approved. */
export type FloorPlanFollowOffset = {
  planId: string;
  riserId: string;
  dx: number;
  dy: number;
};

export type FloorPlanEditRibbonSession = {
  drawTool: DrawTool;
  rectangleVariant: ShapeCrossVariant;
  circleVariant: ShapeCrossVariant;
  strokeColor: string;
  strokeWidthPt: number;
  showPin: boolean;
  showReferenceAnchor: boolean;
  showCrop: boolean;
  showLines: boolean;
  /** Mechanical riser callout bubbles (Sanitary B11, etc.). */
  showRiserLabels: boolean;
  /** Expand the markup SVG past the PDF page edge so off-canvas lines are visible. */
  extendMarkupBounds: boolean;
  showCrossSetLines: boolean;
  overlayEnabled: boolean;
  lineOverlayEnabled: boolean;
  lineOverlayColorFilter: StrokeColorFilter;
  markupSet: MechanicalMarkupSet;
  /** Overlay listing tagged risers by floor / type / number. */
  riserInventoryOpen: boolean;
  /** Catalog instances to copy onto each floor until marked completed. */
  followedRiserIds: string[];
  /** Floors where the user deleted the followed riser (do not re-import). */
  followedRiserSkipped: FloorPlanFollowSkip[];
  /** Unsaved follow-box nudges keyed by floor + catalog instance. */
  followedRiserOffsets: FloorPlanFollowOffset[];
};

const DEFAULT_RIBBON: FloorPlanEditRibbonSession = {
  drawTool: "none",
  rectangleVariant: "plain",
  circleVariant: "plain",
  strokeColor: DRAW_COLORS[0],
  strokeWidthPt: 2,
  showPin: true,
  showReferenceAnchor: true,
  showCrop: true,
  showLines: true,
  showRiserLabels: true,
  extendMarkupBounds: true,
  showCrossSetLines: false,
  overlayEnabled: false,
  lineOverlayEnabled: false,
  lineOverlayColorFilter: "all",
  markupSet: 1,
  riserInventoryOpen: false,
  followedRiserIds: [],
  followedRiserSkipped: [],
  followedRiserOffsets: [],
};

const RIBBON_STORAGE_KEY = "floor-plan-edit-ribbon";

let ribbonSession: FloorPlanEditRibbonSession = { ...DEFAULT_RIBBON };
let ribbonHydratedFromStorage = false;
let viewSession: PinRelativeView | null = null;
let pendingInventoryRiserPan: string | null = null;

export function defaultFloorPlanEditRibbonSession(): FloorPlanEditRibbonSession {
  return { ...DEFAULT_RIBBON };
}

function hydrateRibbonFromStorage(): void {
  if (ribbonHydratedFromStorage || typeof window === "undefined") return;
  ribbonHydratedFromStorage = true;
  try {
    const raw = window.localStorage.getItem(RIBBON_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<FloorPlanEditRibbonSession>;
    ribbonSession = normalizeRibbon({ ...DEFAULT_RIBBON, ...parsed });
  } catch {
    // Ignore corrupt storage.
  }
}

function persistRibbonToStorage(next: FloorPlanEditRibbonSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIBBON_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota errors.
  }
}

export function readFloorPlanEditRibbonSession(): FloorPlanEditRibbonSession {
  return { ...ribbonSession };
}

/** Load localStorage into memory. Call from useLayoutEffect after mount, not during render. */
export function hydrateFloorPlanEditRibbonFromStorage(): FloorPlanEditRibbonSession {
  hydrateRibbonFromStorage();
  return { ...ribbonSession };
}

export function writeFloorPlanEditRibbonSession(
  next: FloorPlanEditRibbonSession,
): void {
  ribbonSession = normalizeRibbon(next);
  ribbonHydratedFromStorage = true;
  persistRibbonToStorage(ribbonSession);
}

export function readFloorPlanEditViewSession(): PinRelativeView | null {
  return viewSession ? { ...viewSession } : null;
}

export function writeFloorPlanEditViewSession(next: PinRelativeView): void {
  if (!(next.zoom > 0) || !Number.isFinite(next.zoom)) return;
  if (!Number.isFinite(next.pinScreenX) || !Number.isFinite(next.pinScreenY)) {
    return;
  }
  viewSession = { ...next };
}

export function setPendingInventoryRiserPan(riserId: string): void {
  pendingInventoryRiserPan = riserId;
}

export function peekPendingInventoryRiserPan(): string | null {
  return pendingInventoryRiserPan;
}

export function clearPendingInventoryRiserPan(): void {
  pendingInventoryRiserPan = null;
}

export function resetFloorPlanEditSessionForTests(): void {
  ribbonSession = { ...DEFAULT_RIBBON };
  ribbonHydratedFromStorage = false;
  viewSession = null;
  pendingInventoryRiserPan = null;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(RIBBON_STORAGE_KEY);
    } catch {
      // Ignore storage errors in tests.
    }
  }
}

function isDrawTool(value: string): value is DrawTool {
  return (DRAW_TOOLS as readonly string[]).includes(value);
}

function isShapeVariant(value: string): value is ShapeCrossVariant {
  return value === "plain" || value === "cross";
}

function normalizeRibbon(
  next: FloorPlanEditRibbonSession,
): FloorPlanEditRibbonSession {
  const width = STROKE_WIDTHS_PT.some((item) => item === next.strokeWidthPt)
    ? next.strokeWidthPt
    : DEFAULT_RIBBON.strokeWidthPt;
  return {
    drawTool: isDrawTool(next.drawTool) ? next.drawTool : DEFAULT_RIBBON.drawTool,
    rectangleVariant: isShapeVariant(next.rectangleVariant)
      ? next.rectangleVariant
      : DEFAULT_RIBBON.rectangleVariant,
    circleVariant: isShapeVariant(next.circleVariant)
      ? next.circleVariant
      : DEFAULT_RIBBON.circleVariant,
    strokeColor:
      typeof next.strokeColor === "string" && next.strokeColor.length > 0
        ? next.strokeColor
        : DEFAULT_RIBBON.strokeColor,
    strokeWidthPt: width,
    showPin: Boolean(next.showPin),
    showReferenceAnchor: Boolean(next.showReferenceAnchor),
    showCrop: Boolean(next.showCrop),
    showLines: Boolean(next.showLines),
    showRiserLabels:
      next.showRiserLabels === undefined
        ? DEFAULT_RIBBON.showRiserLabels
        : Boolean(next.showRiserLabels),
    extendMarkupBounds:
      next.extendMarkupBounds === undefined
        ? DEFAULT_RIBBON.extendMarkupBounds
        : Boolean(next.extendMarkupBounds),
    showCrossSetLines: Boolean(next.showCrossSetLines),
    overlayEnabled: Boolean(next.overlayEnabled),
    lineOverlayEnabled: Boolean(next.lineOverlayEnabled) || Boolean(next.showCrossSetLines),
    lineOverlayColorFilter:
      next.lineOverlayColorFilter === "all" ||
      Array.isArray(next.lineOverlayColorFilter)
        ? next.lineOverlayColorFilter
        : DEFAULT_RIBBON.lineOverlayColorFilter,
    markupSet: parseMechanicalMarkupSet(next.markupSet),
    riserInventoryOpen: Boolean(next.riserInventoryOpen),
    followedRiserIds: parseFollowedRiserIds(next),
    followedRiserSkipped: parseFollowedRiserSkipped(next.followedRiserSkipped),
    followedRiserOffsets: parseFollowedRiserOffsets(next.followedRiserOffsets),
  };
}

function parseFollowedRiserIds(
  value: { followedRiserIds?: unknown; followedRiserId?: unknown },
): string[] {
  if (Array.isArray(value.followedRiserIds)) {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const entry of value.followedRiserIds) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      next.push(trimmed);
    }
    if (next.length > 0) return next;
  }
  if (typeof value.followedRiserId === "string") {
    const trimmed = value.followedRiserId.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return [];
}

function parseFollowedRiserSkipped(value: unknown): FloorPlanFollowSkip[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: FloorPlanFollowSkip[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry == null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.planId !== "string" || typeof row.riserId !== "string") {
      continue;
    }
    const planId = row.planId.trim();
    const riserId = row.riserId.trim();
    if (!planId || !riserId) continue;
    const key = `${planId}:${riserId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ planId, riserId });
  }
  return next;
}

export function followSkipHas(
  skipped: FloorPlanFollowSkip[],
  planId: string,
  riserId: string,
): boolean {
  return skipped.some(
    (entry) => entry.planId === planId && entry.riserId === riserId,
  );
}

export function followSkipAdd(
  skipped: FloorPlanFollowSkip[],
  planId: string,
  riserId: string,
): FloorPlanFollowSkip[] {
  if (followSkipHas(skipped, planId, riserId)) return skipped;
  return [...skipped, { planId, riserId }];
}

export function followSkipClear(
  skipped: FloorPlanFollowSkip[],
  planId: string,
  riserId: string,
): FloorPlanFollowSkip[] {
  return skipped.filter(
    (entry) => !(entry.planId === planId && entry.riserId === riserId),
  );
}

function parseFollowedRiserOffsets(value: unknown): FloorPlanFollowOffset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: FloorPlanFollowOffset[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry == null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.planId !== "string" || typeof row.riserId !== "string") {
      continue;
    }
    const planId = row.planId.trim();
    const riserId = row.riserId.trim();
    const dx = typeof row.dx === "number" && Number.isFinite(row.dx) ? row.dx : 0;
    const dy = typeof row.dy === "number" && Number.isFinite(row.dy) ? row.dy : 0;
    if (!planId || !riserId) continue;
    if (dx === 0 && dy === 0) continue;
    const key = `${planId}:${riserId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ planId, riserId, dx, dy });
  }
  return next;
}

export function followOffsetGet(
  offsets: FloorPlanFollowOffset[],
  planId: string,
  riserId: string,
): FloorPlanFollowOffset | undefined {
  return offsets.find(
    (entry) => entry.planId === planId && entry.riserId === riserId,
  );
}

export function followOffsetSet(
  offsets: FloorPlanFollowOffset[],
  planId: string,
  riserId: string,
  dx: number,
  dy: number,
): FloorPlanFollowOffset[] {
  const next = offsets.filter(
    (entry) => !(entry.planId === planId && entry.riserId === riserId),
  );
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    (dx === 0 && dy === 0)
  ) {
    return next;
  }
  return [...next, { planId, riserId, dx, dy }];
}
