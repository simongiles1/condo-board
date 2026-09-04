import {
  defaultCropOverlayId,
  planHasPin,
  type PdfPoint,
} from "@/lib/building/floor-plan-align";
import { resolveFloorPlanAnnotationMarkup } from "@/lib/building/floor-plan-annotation-draft";
import { annotationsForHigherFloor } from "@/lib/building/floor-plan-riser-links";
import {
  annotationHasRiser,
  calloutRiserIds,
  narrowCalloutToRisers,
  riserIsCompleted,
  type MechanicalRiserDto,
  type MechanicalRiserTypeDto,
} from "@/lib/building/floor-plan-mechanical-risers";
import {
  annotationMarkupSet,
  annotationsGeometricallyEqual,
  filterAnnotationsByMarkupSet,
  filterAnnotationsByStrokeColors,
  mapAnnotationsAcrossPlans,
  mapAnnotationsToCroppedPlate,
  offsetAnnotation,
  stampAnnotationMarkupSet,
  strokeColorFilterHasSelection,
  type FloorPlanAnnotation,
  type MechanicalMarkupSet,
  type StrokeColorFilter,
} from "@/lib/building/floor-plan-annotations";
import type { FloorPlanFollowOffset } from "@/lib/building/floor-plan-edit-session";
import {
  otherDrawingSet,
  planForDrawingSetFloor,
  type FloorPlanDrawingSet,
} from "@/lib/building/floor-plan-shared";

export type CompareAnnotationPlan = {
  id: string;
  familyId: string;
  floorNumber: number;
  name: string;
  annotations: FloorPlanAnnotation[];
  pinXPt: number | null;
  pinYPt: number | null;
  cropXPt: number | null;
  cropYPt: number | null;
};

export type CompareAnnotationFamily = {
  id: string;
  kind?: FloorPlanDrawingSet;
  scaleDenominator?: number | null;
};

function planHasSavedMarkup(
  plan: CompareAnnotationPlan,
  markupSet?: MechanicalMarkupSet,
): boolean {
  const resolved = resolveFloorPlanAnnotationMarkup(plan.id, plan.annotations);
  const scoped =
    markupSet == null
      ? resolved
      : filterAnnotationsByMarkupSet(resolved, markupSet);
  return scoped.length > 0;
}

function resolveScopedMarkup(
  plan: CompareAnnotationPlan,
  markupSet?: MechanicalMarkupSet,
): FloorPlanAnnotation[] {
  const resolved = resolveFloorPlanAnnotationMarkup(plan.id, plan.annotations);
  return markupSet == null
    ? resolved
    : filterAnnotationsByMarkupSet(resolved, markupSet);
}

/** Nearest cropped sibling in the same family that already has markup. */
export function familyAnnotationSourcePlan(
  plans: CompareAnnotationPlan[],
  plan: { id: string; familyId: string; floorNumber: number },
  markupSet?: MechanicalMarkupSet,
): CompareAnnotationPlan | null {
  const siblings = plans
    .filter(
      (item) =>
        item.familyId === plan.familyId &&
        item.id !== plan.id &&
        planHasPin(item) &&
        planHasSavedMarkup(item, markupSet),
    )
    .sort(
      (a, b) =>
        a.floorNumber - b.floorNumber || a.name.localeCompare(b.name),
    );
  if (siblings.length === 0) return null;
  const prev = [...siblings]
    .reverse()
    .find((item) => item.floorNumber <= plan.floorNumber);
  return prev ?? siblings[0];
}

/** Same default as edit-mode line overlay: nearest pinned sheet at or below. */
export function overlayAnnotationSourcePlan(
  plans: CompareAnnotationPlan[],
  plan: { id: string; floorNumber: number },
): CompareAnnotationPlan | null {
  const candidates = plans
    .filter(
      (item) =>
        item.id !== plan.id && planHasPin(item) && planHasSavedMarkup(item),
    )
    .sort(
      (a, b) =>
        a.floorNumber - b.floorNumber || a.name.localeCompare(b.name),
    );
  const sourceId = defaultCropOverlayId(candidates, plan.floorNumber);
  if (!sourceId) return null;
  return candidates.find((item) => item.id === sourceId) ?? null;
}

function mapMarkupOntoPlan(
  source: CompareAnnotationPlan,
  sourceFamily: CompareAnnotationFamily,
  target: CompareAnnotationPlan,
  targetFamily: CompareAnnotationFamily,
  markupSet?: MechanicalMarkupSet,
): FloorPlanAnnotation[] {
  if (!planHasPin(source) || !planHasPin(target)) return [];
  return mapAnnotationsAcrossPlans(
    annotationsForHigherFloor(resolveScopedMarkup(source, markupSet)),
    { x: source.pinXPt!, y: source.pinYPt! },
    { x: target.pinXPt!, y: target.pinYPt! },
    sourceFamily,
    targetFamily,
  );
}

function markupSetForFamily(
  family: CompareAnnotationFamily,
  markupSet?: MechanicalMarkupSet,
): MechanicalMarkupSet | undefined {
  if (family.kind === "architectural") return undefined;
  return markupSet;
}

function familiesWithDrawingSet(
  families: CompareAnnotationFamily[],
): Array<CompareAnnotationFamily & { kind: FloorPlanDrawingSet }> {
  return families.filter(
    (item): item is CompareAnnotationFamily & { kind: FloorPlanDrawingSet } =>
      item.kind === "architectural" || item.kind === "mechanical",
  );
}

/** Pinned sheet on this floor in the other drawing set, if any. */
export function compareCrossSetSourcePlan(
  allPlans: CompareAnnotationPlan[],
  allFamilies: CompareAnnotationFamily[],
  plan: CompareAnnotationPlan,
): CompareAnnotationPlan | null {
  const currentKind = allFamilies.find((item) => item.id === plan.familyId)?.kind;
  if (currentKind !== "architectural" && currentKind !== "mechanical") {
    return null;
  }
  const match = planForDrawingSetFloor(
    allPlans,
    familiesWithDrawingSet(allFamilies),
    otherDrawingSet(currentKind),
    plan.floorNumber,
    { preferName: plan.name },
  );
  if (!match || !planHasPin(match)) return null;
  return match;
}

function pageMarkupForCompareSheet(
  plan: CompareAnnotationPlan,
  family: CompareAnnotationFamily,
  plans: CompareAnnotationPlan[],
  families: CompareAnnotationFamily[],
  markupSet?: MechanicalMarkupSet,
): FloorPlanAnnotation[] {
  const own = resolveScopedMarkup(plan, markupSet);
  if (own.length > 0) return own;
  const familySource = familyAnnotationSourcePlan(plans, plan, markupSet);
  if (!familySource) return [];
  const sourceFamily =
    families.find((item) => item.id === familySource.familyId) ?? family;
  return mapMarkupOntoPlan(
    familySource,
    sourceFamily,
    plan,
    family,
    markupSet,
  );
}

function cropPageMarkup(
  plan: CompareAnnotationPlan,
  pageMarkup: FloorPlanAnnotation[],
): FloorPlanAnnotation[] {
  if (plan.cropXPt == null || plan.cropYPt == null || pageMarkup.length === 0) {
    return [];
  }
  return mapAnnotationsToCroppedPlate(pageMarkup, {
    x: plan.cropXPt,
    y: plan.cropYPt,
  });
}

function mapPageMarkupOntoPlan(
  pageMarkup: FloorPlanAnnotation[],
  source: CompareAnnotationPlan,
  sourceFamily: CompareAnnotationFamily,
  target: CompareAnnotationPlan,
  targetFamily: CompareAnnotationFamily,
): FloorPlanAnnotation[] {
  if (
    pageMarkup.length === 0 ||
    !planHasPin(source) ||
    !planHasPin(target)
  ) {
    return [];
  }
  return mapAnnotationsAcrossPlans(
    annotationsForHigherFloor(pageMarkup),
    { x: source.pinXPt!, y: source.pinYPt! },
    { x: target.pinXPt!, y: target.pinYPt! },
    sourceFamily,
    targetFamily,
  );
}

/**
 * Markup for compare mode on a cropped sheet: this floor's saved lines, or
 * pin-mapped markup from the nearest annotated sibling (tower families often
 * trace once on floor 10 and rely on line overlay for higher floors in edit).
 */
export function annotationsForCompareSheet(
  plan: CompareAnnotationPlan,
  family: CompareAnnotationFamily,
  plans: CompareAnnotationPlan[],
  families: CompareAnnotationFamily[],
  markupSet?: MechanicalMarkupSet,
): FloorPlanAnnotation[] {
  return cropPageMarkup(
    plan,
    pageMarkupForCompareSheet(plan, family, plans, families, markupSet),
  );
}

/**
 * Compare overlay lines: this sheet's markup plus pin-mapped lines from the
 * other drawing set on the same floor, then the edit-mode type filter.
 * Which PDFs are stacked is unrelated — this only decides which strokes paint.
 */
export function visibleAnnotationsForCompareSheet(args: {
  plan: CompareAnnotationPlan;
  family: CompareAnnotationFamily;
  plans: CompareAnnotationPlan[];
  families: CompareAnnotationFamily[];
  allPlans: CompareAnnotationPlan[];
  allFamilies: CompareAnnotationFamily[];
  markupSet?: MechanicalMarkupSet;
  colorFilter: StrokeColorFilter;
}): FloorPlanAnnotation[] {
  const {
    plan,
    family,
    plans,
    families,
    allPlans,
    allFamilies,
    markupSet,
    colorFilter,
  } = args;
  if (!strokeColorFilterHasSelection(colorFilter)) return [];

  const own = annotationsForCompareSheet(
    plan,
    family,
    plans,
    families,
    markupSetForFamily(family, markupSet),
  );

  const crossSetPlan = compareCrossSetSourcePlan(allPlans, allFamilies, plan);
  const crossSetFamily = crossSetPlan
    ? allFamilies.find((item) => item.id === crossSetPlan.familyId) ?? null
    : null;
  const crossSet =
    crossSetPlan && crossSetFamily
      ? cropPageMarkup(
          plan,
          mapPageMarkupOntoPlan(
            pageMarkupForCompareSheet(
              crossSetPlan,
              crossSetFamily,
              allPlans,
              allFamilies,
              markupSetForFamily(crossSetFamily, markupSet),
            ),
            crossSetPlan,
            crossSetFamily,
            plan,
            family,
          ),
        )
      : [];

  return filterAnnotationsByStrokeColors([...own, ...crossSet], colorFilter);
}

/**
 * Pin-mapped markup from the nearest annotated sibling when this floor has
 * nothing saved yet. Edit mode no longer paints this automatically — Lines overlay
 * is opt-in. Compare still uses the same source via annotationsForCompareSheet.
 */
export function overlayAnnotationsForEditSheet(
  plan: CompareAnnotationPlan,
  family: CompareAnnotationFamily,
  plans: CompareAnnotationPlan[],
  families: CompareAnnotationFamily[],
  anchorPin: PdfPoint,
  markupSet?: MechanicalMarkupSet,
): FloorPlanAnnotation[] {
  const own = resolveScopedMarkup(plan, markupSet);
  if (own.length > 0) return [];

  const familySource = familyAnnotationSourcePlan(plans, plan, markupSet);
  if (!familySource || !planHasPin(familySource)) return [];

  const sourceFamily =
    families.find((item) => item.id === familySource.familyId) ?? family;

  return mapAnnotationsAcrossPlans(
    annotationsForHigherFloor(resolveScopedMarkup(familySource, markupSet)),
    { x: familySource.pinXPt!, y: familySource.pinYPt! },
    anchorPin,
    sourceFamily,
    family,
  );
}

/**
 * Boxes labeled with this riser. Prefer `preferredSet` when that pass has
 * them; otherwise take any pass. Mechanical families are often one floor
 * each (different crop plates), so follow cannot be family-scoped.
 */
function markupMatchingRisers(
  plan: CompareAnnotationPlan,
  riserIds: string[],
  preferredSet?: MechanicalMarkupSet,
): FloorPlanAnnotation[] {
  if (riserIds.length === 0) return [];
  const matching = resolveFloorPlanAnnotationMarkup(
    plan.id,
    plan.annotations,
  ).filter((item) => riserIds.some((id) => annotationHasRiser(item, id)));
  if (preferredSet == null || matching.length === 0) return matching;
  const preferred = matching.filter(
    (item) => annotationMarkupSet(item) === preferredSet,
  );
  return preferred.length > 0 ? preferred : matching;
}

/** Catalog ids on a source box that still belong on this floor's overlay. */
function overlayKeepRiserIds(
  item: FloorPlanAnnotation,
  currentAnnotations: FloorPlanAnnotation[],
  risers: MechanicalRiserDto[],
  skippedRiserIds: ReadonlySet<string>,
): string[] {
  if (item.type !== "rectangle" && item.type !== "circle") return [];
  if (!item.callout) return [];
  return calloutRiserIds(item.callout).filter((id) => {
    if (skippedRiserIds.has(id)) return false;
    if (currentAnnotations.some((entry) => annotationHasRiser(entry, id))) {
      return false;
    }
    const riser = risers.find((row) => row.id === id);
    if (riser != null && riserIsCompleted(riser)) return false;
    return true;
  });
}

/**
 * The pinned sheet immediately below this floor. Risers drift, so follow
 * always takes that sheet's position — never a floor further down.
 */
export function planImmediatelyBelow(
  plans: CompareAnnotationPlan[],
  plan: { id: string; floorNumber: number },
): CompareAnnotationPlan | null {
  const below = plans
    .filter(
      (item) =>
        item.id !== plan.id &&
        item.floorNumber < plan.floorNumber &&
        planHasPin(item),
    )
    .sort(
      (a, b) =>
        b.floorNumber - a.floorNumber || a.name.localeCompare(b.name),
    );
  return below[0] ?? null;
}

/** Floor immediately below, only when that sheet already has one of these risers. */
export function sourcePlanForFollowedRiser(
  plans: CompareAnnotationPlan[],
  plan: { id: string; floorNumber: number },
  riserIds: string[],
  markupSet?: MechanicalMarkupSet,
): CompareAnnotationPlan | null {
  const below = planImmediatelyBelow(plans, plan);
  if (!below) return null;
  if (markupMatchingRisers(below, riserIds, markupSet).length === 0) return null;
  return below;
}

/**
 * Overlay preview of followed boxes, pin-mapped from the floor immediately
 * below. One source box becomes one overlay, keeping every catalog id on that
 * callout except ids already saved here, dismissed, or marked completed.
 * Empty when there is no pin or the floor below has no matching box. Approve
 * copies the overlay into this floor's markup.
 */
export function followedRiserOverlayAnnotations(args: {
  plans: CompareAnnotationPlan[];
  families: CompareAnnotationFamily[];
  plan: CompareAnnotationPlan;
  family: CompareAnnotationFamily;
  riserIds: string[];
  skippedRiserIds?: string[];
  markupSet: MechanicalMarkupSet;
  types: MechanicalRiserTypeDto[];
  risers: MechanicalRiserDto[];
  currentAnnotations: FloorPlanAnnotation[];
  anchorPin: PdfPoint | null;
}): FloorPlanAnnotation[] {
  const {
    plans,
    families,
    plan,
    family,
    riserIds,
    skippedRiserIds = [],
    markupSet,
    types,
    risers,
    currentAnnotations,
    anchorPin,
  } = args;
  if (!anchorPin || riserIds.length === 0) return [];
  const skipped = new Set(skippedRiserIds);

  const source = sourcePlanForFollowedRiser(plans, plan, riserIds, markupSet);
  if (!source || !planHasPin(source)) return [];
  const sourceFamily =
    families.find((item) => item.id === source.familyId) ?? family;
  const sourceBoxes = annotationsForHigherFloor(
    markupMatchingRisers(source, riserIds, markupSet),
  ).filter(
    (item) =>
      overlayKeepRiserIds(item, currentAnnotations, risers, skipped).length > 0,
  );
  if (sourceBoxes.length === 0) return [];
  return mapAnnotationsAcrossPlans(
    sourceBoxes,
    { x: source.pinXPt!, y: source.pinYPt! },
    anchorPin,
    sourceFamily,
    family,
  ).flatMap((item) => {
    const stamped = stampAnnotationMarkupSet(item, markupSet);
    if (stamped.type !== "rectangle" && stamped.type !== "circle") {
      return [stamped];
    }
    if (!stamped.callout) return [stamped];
    const keepIds = overlayKeepRiserIds(
      stamped,
      currentAnnotations,
      risers,
      skipped,
    );
    if (keepIds.length === 0) return [];
    if (
      currentAnnotations.some((entry) =>
        annotationsGeometricallyEqual(entry, stamped),
      )
    ) {
      return [];
    }
    return [
      {
        ...stamped,
        callout: narrowCalloutToRisers(
          stamped.callout,
          keepIds,
          types,
          risers,
        ),
      },
    ];
  });
}

/** Catalog ids on a follow overlay box. Empty for unlabeled polylines. */
export function overlayAnnotationRiserIds(
  item: FloorPlanAnnotation,
): string[] {
  if (item.type !== "rectangle" && item.type !== "circle") return [];
  if (!item.callout) return [];
  return calloutRiserIds(item.callout);
}

/** Overlay riser ids whose mapped box already exists on this floor. */
export function riserIdsAdoptedFromMatchingBoxes(
  saved: FloorPlanAnnotation[],
  overlays: FloorPlanAnnotation[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const overlay of overlays) {
    const overlayIds = overlayAnnotationRiserIds(overlay);
    if (overlayIds.length === 0) continue;
    if (!saved.some((item) => annotationsGeometricallyEqual(item, overlay))) {
      continue;
    }
    for (const id of overlayIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Copy overlay callouts onto unlabeled saved boxes that already occupy the
 * same geometry. Returns null when nothing changes.
 */
export function stampCalloutsFromMatchingOverlays(
  saved: FloorPlanAnnotation[],
  overlays: FloorPlanAnnotation[],
): FloorPlanAnnotation[] | null {
  let changed = false;
  const next = saved.map((item) => {
    if (item.type !== "rectangle" && item.type !== "circle") return item;
    if (item.callout && calloutRiserIds(item.callout).length > 0) return item;
    const match = overlays.find(
      (overlay) =>
        (overlay.type === "rectangle" || overlay.type === "circle") &&
        overlay.callout != null &&
        annotationsGeometricallyEqual(overlay, item),
    );
    if (
      !match ||
      (match.type !== "rectangle" && match.type !== "circle") ||
      !match.callout
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      color: match.color,
      callout: { ...match.callout },
    };
  });
  return changed ? next : null;
}

/** Overlay boxes that belong to any of these catalog instances. */
export function overlayAnnotationsMatchingRisers(
  overlays: FloorPlanAnnotation[],
  riserIds: string[],
): FloorPlanAnnotation[] {
  if (riserIds.length === 0) return [];
  return overlays.filter((item) =>
    riserIds.some((id) => annotationHasRiser(item, id)),
  );
}

/** Apply this-floor nudges to follow overlays. First matching riser wins. */
export function applyFollowedRiserOffsets(
  overlays: FloorPlanAnnotation[],
  planId: string,
  offsets: FloorPlanFollowOffset[],
): FloorPlanAnnotation[] {
  if (offsets.length === 0) return overlays;
  return overlays.map((item) => {
    const ids = overlayAnnotationRiserIds(item);
    for (const riserId of ids) {
      const found = offsets.find(
        (entry) => entry.planId === planId && entry.riserId === riserId,
      );
      if (found) return offsetAnnotation(item, found.dx, found.dy);
    }
    return item;
  });
}
