/** Client-safe DTOs for the floor-plan alignment tool. */

import {
  parseFloorPlanAnnotations,
  parseDrawColorPresets,
  type DrawColorPreset,
  type FloorPlanAnnotation,
} from "./floor-plan-annotations";
import type { MechanicalRiserDto } from "./floor-plan-mechanical-risers";
import type { RiserTypeTemplate } from "./floor-plan-riser-templates";
import { resolveFloorPlanAnnotationMarkup } from "./floor-plan-annotation-draft";
import type { FloorPlanStatus, PdfSize } from "./floor-plan-align";
import { planHasPin } from "./floor-plan-align";

export type { FloorPlanStatus };

export const FLOOR_PLAN_DRAWING_SETS = ["architectural", "mechanical"] as const;
export type FloorPlanDrawingSet = (typeof FLOOR_PLAN_DRAWING_SETS)[number];

export type FloorPlanFileKind = "original" | "cropped" | "west" | "east";

export function parseFloorPlanDrawingSet(value: unknown): FloorPlanDrawingSet {
  return value === "mechanical" ? "mechanical" : "architectural";
}

export function parseFloorPlanFileKind(value: unknown): FloorPlanFileKind {
  if (value === "cropped" || value === "west" || value === "east") return value;
  return "original";
}

export function planNeedsMerge(plan: {
  hasWest: boolean;
  hasEast: boolean;
  hasOriginal: boolean;
}): boolean {
  return plan.hasWest && plan.hasEast && !plan.hasOriginal;
}

export type FloorPlanSettingsDto = {
  registrationLabel: string;
  /** Building pin in the registration plan's original-PDF coordinates. */
  pinXPt: number | null;
  pinYPt: number | null;
  /** First drawing that placed the building pin. */
  registrationPlanId: string | null;
  /** Floor whose building pin + reference anchor define the pin offset. */
  pinReferencePlanId: string | null;
  /** Labeled stroke colors for wall markup legend and picker. */
  drawColorPresets: DrawColorPreset[];
  /** Numbered mechanical riser instances (type + number). */
  mechanicalRisers: MechanicalRiserDto[];
  /** Standardized templates per riser type. */
  riserTemplates?: Record<string, RiserTypeTemplate>;
};

export type FloorPlanFamilyDto = {
  id: string;
  name: string;
  kind: FloorPlanDrawingSet;
  sortOrder: number;
  cropWidthPt: number | null;
  cropHeightPt: number | null;
  /** Architectural scale denominator, e.g. 150 for 1:150. */
  scaleDenominator: number | null;
  createdAt: string;
};

export type FloorPlanDto = {
  id: string;
  familyId: string;
  /** Drawing identifier, e.g. An212. */
  name: string;
  notes: string;
  /** Building level; drives list and compare order. */
  floorNumber: number;
  sortOrder: number;
  originalPageWidthPt: number;
  originalPageHeightPt: number;
  cropXPt: number | null;
  cropYPt: number | null;
  /** Where the building pin sits on this sheet's original PDF. */
  pinXPt: number | null;
  pinYPt: number | null;
  /** Structural reference anchor on this sheet's original PDF. */
  referenceAnchorXPt: number | null;
  referenceAnchorYPt: number | null;
  westPageWidthPt: number | null;
  westPageHeightPt: number | null;
  eastPageWidthPt: number | null;
  eastPageHeightPt: number | null;
  eastOffsetXPt: number | null;
  eastOffsetYPt: number | null;
  westCropXPt: number | null;
  westCropYPt: number | null;
  westCropWidthPt: number | null;
  westCropHeightPt: number | null;
  eastCropXPt: number | null;
  eastCropYPt: number | null;
  eastCropWidthPt: number | null;
  eastCropHeightPt: number | null;
  hasOriginal: boolean;
  hasCropped: boolean;
  hasWest: boolean;
  hasEast: boolean;
  status: FloorPlanStatus;
  /** Saved line/rectangle markup on the original PDF. */
  annotations: FloorPlanAnnotation[];
  createdAt: string;
  updatedAt: string;
};

export type FloorPlansPayload = {
  settings: FloorPlanSettingsDto;
  families: FloorPlanFamilyDto[];
  plans: FloorPlanDto[];
};

export function familyCropSize(family: FloorPlanFamilyDto): PdfSize | null {
  if (
    family.cropWidthPt != null &&
    family.cropHeightPt != null &&
    family.cropWidthPt > 0 &&
    family.cropHeightPt > 0
  ) {
    return { width: family.cropWidthPt, height: family.cropHeightPt };
  }
  return null;
}

export function familiesOfDrawingSet<T extends { kind: FloorPlanDrawingSet }>(
  families: T[],
  kind: FloorPlanDrawingSet,
): T[] {
  return families.filter((family) => family.kind === kind);
}

export function plansOfDrawingSet<
  P extends { familyId: string },
  F extends { id: string; kind: FloorPlanDrawingSet },
>(plans: P[], families: F[], kind: FloorPlanDrawingSet): P[] {
  const ids = new Set(
    families.filter((family) => family.kind === kind).map((family) => family.id),
  );
  return plans.filter((plan) => ids.has(plan.familyId));
}

export function floorPlanFileUrl(
  planId: string,
  kind: FloorPlanFileKind,
  cacheBust?: string,
): string {
  const params = new URLSearchParams({ kind });
  if (cacheBust) params.set("t", cacheBust);
  return `/api/building/floor-plans/${encodeURIComponent(planId)}/file?${params.toString()}`;
}

export function floorPlanLabel(plan: {
  name: string;
  floorNumber: number;
}): string {
  return `${plan.name} · Floor ${plan.floorNumber}`;
}

/** Integer floor number from JSON or form fields. Rejects floats and blanks. */
export function parseFloorNumber(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    return Number.parseInt(trimmed, 10);
  }
  return null;
}

/**
 * Split a combined label such as "An212 - Floor 12" into drawing name + floor.
 * Returns null floorNumber when none can be read.
 */
export function parseFloorPlanName(raw: string): {
  name: string;
  floorNumber: number | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { name: "", floorNumber: null };

  const hyphenFloor = trimmed.match(
    /^(.*?)\s*[-–—]\s*(?:floor|lvl|level)\s+(-?\d+)\s*$/i,
  );
  if (hyphenFloor) {
    const name = hyphenFloor[1].trim();
    return {
      name: name || trimmed,
      floorNumber: Number.parseInt(hyphenFloor[2], 10),
    };
  }

  const floorOnly = trimmed.match(/^(?:floor|lvl|level)\s+(-?\d+)\s*$/i);
  if (floorOnly) {
    return {
      name: trimmed,
      floorNumber: Number.parseInt(floorOnly[1], 10),
    };
  }

  const hyphenNum = trimmed.match(/^(.*?)\s*[-–—]\s*(-?\d+)\s*$/);
  if (hyphenNum && hyphenNum[1].trim()) {
    return {
      name: hyphenNum[1].trim(),
      floorNumber: Number.parseInt(hyphenNum[2], 10),
    };
  }

  if (/^-?\d+$/.test(trimmed)) {
    return { name: trimmed, floorNumber: Number.parseInt(trimmed, 10) };
  }

  return { name: trimmed, floorNumber: null };
}

/** Floors with saved markup anywhere in the drawing set, for the line-overlay dropdown in edit mode. */
export function lineOverlayCandidates(
  plans: FloorPlanDto[],
  plan: { id: string },
): FloorPlanDto[] {
  return plans
    .filter(
      (item) =>
        item.id !== plan.id &&
        resolveFloorPlanAnnotationMarkup(item.id, item.annotations).length >
          0 &&
        planHasPin(item),
    )
    .sort(
      (a, b) =>
        a.floorNumber - b.floorNumber || a.name.localeCompare(b.name),
    );
}

export function otherDrawingSet(
  set: FloorPlanDrawingSet,
): FloorPlanDrawingSet {
  return set === "mechanical" ? "architectural" : "mechanical";
}

export function drawingSetLabel(set: FloorPlanDrawingSet): string {
  return set === "mechanical" ? "Mechanical" : "Architectural";
}

export type PlanForDrawingSetFloorOptions<
  P extends { id: string; name: string },
> = {
  preferPlanId?: string;
  /** Prefer a plan with the same drawing name on the target set. */
  preferName?: string;
};

function pickBestPlanForFloor<
  P extends { id: string; name: string; annotations?: FloorPlanAnnotation[] },
>(candidates: P[]): P {
  const withMarkup = candidates.filter((item) => (item.annotations?.length ?? 0) > 0);
  const pool = withMarkup.length > 0 ? withMarkup : candidates;
  return [...pool].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  )[0];
}

/**
 * The pinned plan on the same floor in the other drawing set, if any.
 * Cross-set line visibility always maps floor number to floor number.
 */
export function crossSetLinePlanForFloor(
  allPlans: FloorPlanDto[],
  allFamilies: FloorPlanFamilyDto[],
  plan: { floorNumber: number; name: string },
  currentSet: FloorPlanDrawingSet,
): FloorPlanDto | null {
  const match = planForDrawingSetFloor(
    allPlans,
    allFamilies,
    otherDrawingSet(currentSet),
    plan.floorNumber,
    { preferName: plan.name },
  );
  if (!match || !planHasPin(match)) return null;
  return match;
}

/** Find the best matching plan in a drawing set for the given floor number. */
export function planForDrawingSetFloor<
  P extends {
    id: string;
    name: string;
    floorNumber: number;
    familyId: string;
    annotations?: FloorPlanAnnotation[];
  },
  F extends { id: string; kind: FloorPlanDrawingSet },
>(
  plans: P[],
  families: F[],
  set: FloorPlanDrawingSet,
  floorNumber: number,
  options?: PlanForDrawingSetFloorOptions<P>,
): P | null {
  const candidates = plansOfDrawingSet(plans, families, set).filter(
    (item) => item.floorNumber === floorNumber,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (options?.preferPlanId) {
    const preferred = candidates.find((item) => item.id === options.preferPlanId);
    if (preferred) return preferred;
  }

  if (options?.preferName) {
    const normalized = options.preferName.toLowerCase();
    const byName = candidates.filter(
      (item) => item.name.toLowerCase() === normalized,
    );
    if (byName.length > 0) return pickBestPlanForFloor(byName);
  }

  return pickBestPlanForFloor(candidates);
}

export { parseFloorPlanAnnotations, parseDrawColorPresets };
