import {
  floorPlanAnnotationsEqual,
  parseFloorPlanAnnotations,
  type FloorPlanAnnotation,
} from "@/lib/building/floor-plan-annotations";

const STORAGE_KEY_PREFIX = "floor-plan-annotation-draft:";

type FloorPlanAnnotationDraft = {
  annotations: FloorPlanAnnotation[];
  /** Server markup when the draft was last written; detects stale drafts after save. */
  savedBaseline: FloorPlanAnnotation[];
};

const memoryDrafts = new Map<string, FloorPlanAnnotationDraft>();

function storageKey(planId: string): string {
  return `${STORAGE_KEY_PREFIX}${planId}`;
}

function parseStoredDraft(raw: unknown): FloorPlanAnnotationDraft | null {
  if (Array.isArray(raw)) {
    const annotations = parseFloorPlanAnnotations(raw);
    return { annotations, savedBaseline: [] };
  }
  if (typeof raw !== "object" || raw == null) return null;
  const entry = raw as Record<string, unknown>;
  if (!Array.isArray(entry.annotations)) return null;
  const annotations = parseFloorPlanAnnotations(entry.annotations);
  const savedBaseline = Array.isArray(entry.savedBaseline)
    ? parseFloorPlanAnnotations(entry.savedBaseline)
    : [];
  return { annotations, savedBaseline };
}

export function readFloorPlanAnnotationDraft(
  planId: string,
): FloorPlanAnnotationDraft | null {
  const cached = memoryDrafts.get(planId);
  if (cached) return cached;

  if (typeof sessionStorage === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(storageKey(planId));
    if (!raw) return null;
    const parsed = parseStoredDraft(JSON.parse(raw));
    if (!parsed) return null;
    memoryDrafts.set(planId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeFloorPlanAnnotationDraft(
  planId: string,
  annotations: FloorPlanAnnotation[],
  savedBaseline: FloorPlanAnnotation[],
): void {
  const draft: FloorPlanAnnotationDraft = { annotations, savedBaseline };
  memoryDrafts.set(planId, draft);
  if (typeof sessionStorage === "undefined") return;

  try {
    sessionStorage.setItem(storageKey(planId), JSON.stringify(draft));
  } catch {
    // Quota or private browsing — in-memory draft still survives expand/collapse.
  }
}

export function clearFloorPlanAnnotationDraft(planId: string): void {
  memoryDrafts.delete(planId);
  if (typeof sessionStorage === "undefined") return;

  try {
    sessionStorage.removeItem(storageKey(planId));
  } catch {
    // Ignore storage errors on clear.
  }
}

/** Prefer a local draft over server markup when it differs from what is saved. */
export function resolveFloorPlanAnnotationMarkup(
  planId: string,
  saved: FloorPlanAnnotation[],
): FloorPlanAnnotation[] {
  const draft = readFloorPlanAnnotationDraft(planId);
  if (!draft) return saved;
  if (floorPlanAnnotationsEqual(draft.annotations, saved)) {
    clearFloorPlanAnnotationDraft(planId);
    return saved;
  }
  if (
    draft.savedBaseline.length > 0 &&
    !floorPlanAnnotationsEqual(draft.savedBaseline, saved)
  ) {
    clearFloorPlanAnnotationDraft(planId);
    return saved;
  }
  // Legacy drafts without a baseline: an empty draft must not hide saved markup.
  if (
    draft.savedBaseline.length === 0 &&
    draft.annotations.length === 0 &&
    saved.length > 0
  ) {
    clearFloorPlanAnnotationDraft(planId);
    return saved;
  }
  // Empty draft with a baseline that still matches the server — e.g. after
  // navigation without save — must not wipe visible saved lines on reload.
  if (
    draft.annotations.length === 0 &&
    saved.length > 0 &&
    draft.savedBaseline.length > 0 &&
    floorPlanAnnotationsEqual(draft.savedBaseline, saved)
  ) {
    clearFloorPlanAnnotationDraft(planId);
    return saved;
  }
  return draft.annotations;
}
