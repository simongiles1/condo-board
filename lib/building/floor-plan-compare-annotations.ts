import {
  defaultCropOverlayId,
  planHasPin,
  type PdfPoint,
} from "@/lib/building/floor-plan-align";
import { resolveFloorPlanAnnotationMarkup } from "@/lib/building/floor-plan-annotation-draft";
import {
  mapAnnotationsAcrossPlans,
  mapAnnotationsToCroppedPlate,
  type FloorPlanAnnotation,
} from "@/lib/building/floor-plan-annotations";
import { annotationsForHigherFloor } from "@/lib/building/floor-plan-riser-links";

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

type CompareAnnotationFamily = {
  id: string;
  scaleDenominator?: number | null;
};

function planHasSavedMarkup(plan: CompareAnnotationPlan): boolean {
  return resolveFloorPlanAnnotationMarkup(plan.id, plan.annotations).length > 0;
}

/** Nearest cropped sibling in the same family that already has markup. */
export function familyAnnotationSourcePlan(
  plans: CompareAnnotationPlan[],
  plan: { id: string; familyId: string; floorNumber: number },
): CompareAnnotationPlan | null {
  const siblings = plans
    .filter(
      (item) =>
        item.familyId === plan.familyId &&
        item.id !== plan.id &&
        planHasPin(item) &&
        planHasSavedMarkup(item),
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
): FloorPlanAnnotation[] {
  if (!planHasPin(source) || !planHasPin(target)) return [];
  return mapAnnotationsAcrossPlans(
    annotationsForHigherFloor(
      resolveFloorPlanAnnotationMarkup(source.id, source.annotations),
    ),
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
): FloorPlanAnnotation[] {
  if (plan.cropXPt == null || plan.cropYPt == null) return [];

  const own = resolveFloorPlanAnnotationMarkup(plan.id, plan.annotations);
  let pageMarkup = own;

  if (pageMarkup.length === 0) {
    const familySource = familyAnnotationSourcePlan(plans, plan);
    if (familySource) {
      const sourceFamily =
        families.find((item) => item.id === familySource.familyId) ?? family;
      pageMarkup = mapMarkupOntoPlan(
        familySource,
        sourceFamily,
        plan,
        family,
      );
    }
  }

  if (pageMarkup.length === 0) return [];

  return mapAnnotationsToCroppedPlate(pageMarkup, {
    x: plan.cropXPt,
    y: plan.cropYPt,
  });
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
): FloorPlanAnnotation[] {
  const own = resolveFloorPlanAnnotationMarkup(plan.id, plan.annotations);
  if (own.length > 0) return [];

  const familySource = familyAnnotationSourcePlan(plans, plan);
  if (!familySource || !planHasPin(familySource)) return [];

  const sourceFamily =
    families.find((item) => item.id === familySource.familyId) ?? family;

  return mapAnnotationsAcrossPlans(
    annotationsForHigherFloor(
      resolveFloorPlanAnnotationMarkup(
        familySource.id,
        familySource.annotations,
      ),
    ),
    { x: familySource.pinXPt!, y: familySource.pinYPt! },
    anchorPin,
    sourceFamily,
    family,
  );
}
