/** Mechanical riser catalog: types (function + color + shortcut) and labeled instances. */

import type { PdfPoint } from "@/lib/building/floor-plan-align";
import {
  normalizeStrokeColor,
  pdfRectCenter,
  presetDrawColorFamily,
  type DrawColorPreset,
  type FloorPlanAnnotation,
  type FloorPlanCallout,
} from "@/lib/building/floor-plan-annotations";
import { boxCenter, isConnectableBox } from "@/lib/building/floor-plan-riser-links";
import {
  followSkipHas,
  type FloorPlanFollowSkip,
} from "@/lib/building/floor-plan-edit-session";

export const MECHANICAL_RISER_LABEL_MAX = 32;

export type MechanicalRiserTypeDto = {
  id: string;
  name: string;
  color: string;
  shortcut?: string;
  sortOrder: number;
};

export type MechanicalRiserDto = {
  id: string;
  typeId: string;
  label: string;
  /** True once this stack has been traced to its top floor. */
  completed?: boolean;
};

export function riserIsCompleted(riser: MechanicalRiserDto): boolean {
  return riser.completed === true;
}

export function compareRiserLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function formatMechanicalRiserLabel(
  typeName: string,
  label: string,
): string {
  return `${typeName} ${label}`;
}

/** True when a callout is tied to the mechanical riser catalog (not free text). */
export function isMechanicalRiserCallout(callout: {
  typeId?: string;
  riserId?: string;
  riserIds?: string[];
}): boolean {
  if (calloutRiserIds(callout).length > 0) return true;
  return typeof callout.typeId === "string" && callout.typeId.length > 0;
}

/** Riser ids stored on a callout (`riserIds` preferred; `riserId` legacy). */
export function calloutRiserIds(callout: {
  riserId?: string;
  riserIds?: string[];
}): string[] {
  if (Array.isArray(callout.riserIds) && callout.riserIds.length > 0) {
    return callout.riserIds.filter(Boolean);
  }
  if (callout.riserId) return [callout.riserId];
  return [];
}

export function findRiserByTypeAndLabel(
  risers: MechanicalRiserDto[],
  typeId: string,
  label: string,
): MechanicalRiserDto | undefined {
  const normalized = parseRiserLabel(label);
  if (normalized == null) return undefined;
  return risers.find(
    (riser) =>
      riser.typeId === typeId &&
      riser.label.toLowerCase() === normalized.toLowerCase(),
  );
}

/** Label for one or more riser labels of the same type (e.g. Riser - Kitchen B2, B3). */
export function formatMechanicalRiserLabels(
  type: Pick<MechanicalRiserTypeDto, "name">,
  labels: string[],
): string {
  const sorted = [...labels].sort(compareRiserLabels);
  if (sorted.length === 0) return "";
  return `${type.name.trim()} ${sorted.join(", ")}`;
}

export function parseRiserLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MECHANICAL_RISER_LABEL_MAX) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9,.\-/ ]*$/.test(trimmed)) return null;
  return trimmed;
}

/** @deprecated Use {@link parseRiserLabel}. Kept for numeric-only callers during transition. */
export function parseRiserNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1 || raw > 9999) return null;
    return raw;
  }
  const label = parseRiserLabel(raw);
  if (label == null || !/^\d+$/.test(label)) return null;
  const value = Number(label);
  if (!Number.isInteger(value) || value < 1 || value > 9999) return null;
  return value;
}

export function riserTypeToPreset(
  type: MechanicalRiserTypeDto,
): DrawColorPreset {
  const preset: DrawColorPreset = {
    color: type.color,
    label: type.name,
    family: "mechanical",
    typeId: type.id,
  };
  if (type.shortcut) preset.shortcut = type.shortcut;
  return preset;
}

export function architecturalPresetsOnly(
  presets: DrawColorPreset[],
): DrawColorPreset[] {
  return presets
    .filter((preset) => presetDrawColorFamily(preset) === "architectural")
    .map((preset) => {
      const next: DrawColorPreset = {
        color: preset.color,
        label: preset.label,
        family: "architectural",
      };
      if (preset.shortcut) next.shortcut = preset.shortcut;
      return next;
    });
}

export function mergeDrawColorPresets(
  architectural: DrawColorPreset[],
  types: MechanicalRiserTypeDto[],
): DrawColorPreset[] {
  return [
    ...architecturalPresetsOnly(architectural),
    ...types.map(riserTypeToPreset),
  ];
}

export function mechanicalTypesFromPresets(
  presets: DrawColorPreset[],
): MechanicalRiserTypeDto[] {
  const rows = presets.filter(
    (preset) => presetDrawColorFamily(preset) === "mechanical",
  );
  return rows.map((preset, index) => {
    const type: MechanicalRiserTypeDto = {
      id:
        typeof preset.typeId === "string" && preset.typeId.trim()
          ? preset.typeId.trim()
          : "",
      name: preset.label.trim() || "Untitled",
      color: normalizeStrokeColor(preset.color),
      sortOrder: index,
    };
    if (preset.shortcut) type.shortcut = preset.shortcut;
    return type;
  });
}

export function matchMechanicalTypeByColor(
  types: MechanicalRiserTypeDto[],
  color: string,
): MechanicalRiserTypeDto | undefined {
  const normalized = normalizeStrokeColor(color);
  return types.find(
    (type) => normalizeStrokeColor(type.color) === normalized,
  );
}

export function labelsForRiserType(
  risers: MechanicalRiserDto[],
  typeId: string,
): string[] {
  return risers
    .filter((riser) => riser.typeId === typeId)
    .map((riser) => riser.label)
    .sort(compareRiserLabels);
}

/** @deprecated Use {@link labelsForRiserType}. */
export function numbersForRiserType(
  risers: MechanicalRiserDto[],
  typeId: string,
): string[] {
  return labelsForRiserType(risers, typeId);
}

export function resolveCalloutDisplayText(
  callout: { text: string; riserId?: string; riserIds?: string[] },
  types: MechanicalRiserTypeDto[],
  risers: MechanicalRiserDto[],
): string {
  const ids = calloutRiserIds(callout);
  if (ids.length === 0) return callout.text;
  const resolved = ids
    .map((id) => risers.find((item) => item.id === id))
    .filter((riser): riser is MechanicalRiserDto => riser != null);
  if (resolved.length === 0) return callout.text;
  const type = types.find((item) => item.id === resolved[0]!.typeId);
  if (!type) return callout.text;
  const sameType = resolved.every((riser) => riser.typeId === type.id);
  if (!sameType) return callout.text;
  return formatMechanicalRiserLabels(
    type,
    resolved.map((riser) => riser.label),
  );
}

export function lookupRiser(
  risers: MechanicalRiserDto[],
  riserId: string | undefined,
): MechanicalRiserDto | undefined {
  if (!riserId) return undefined;
  return risers.find((item) => item.id === riserId);
}

/** True when a box callout is assigned this catalog instance. */
export function annotationHasRiser(
  item: FloorPlanAnnotation,
  riserId: string,
): boolean {
  if (item.type !== "rectangle" && item.type !== "circle") return false;
  if (!item.callout) return false;
  return calloutRiserIds(item.callout).includes(riserId);
}

/** Callout position when present, otherwise the box center (PDF points). */
export function riserAnnotationFocusPoint(
  annotations: FloorPlanAnnotation[],
  riserId: string,
): PdfPoint | null {
  for (const item of annotations) {
    if (!annotationHasRiser(item, riserId)) continue;
    if (item.callout) {
      return { x: item.callout.x, y: item.callout.y };
    }
    if (isConnectableBox(item)) {
      return boxCenter(item);
    }
    if (item.type === "rectangle" || item.type === "circle") {
      return pdfRectCenter(item.rect);
    }
  }
  return null;
}

/** First matching focus point across annotation lists, in order. */
export function findRiserFocusPoint(
  riserId: string,
  ...annotationLists: FloorPlanAnnotation[][]
): PdfPoint | null {
  for (const annotations of annotationLists) {
    const point = riserAnnotationFocusPoint(annotations, riserId);
    if (point) return point;
  }
  return null;
}

/**
 * When following riser stacks, keep mechanical lines plus markup for those
 * stacks only. Unlabeled boxes stay visible so already-placed work is not
 * hidden just because the callout has no catalog id yet.
 */
export function annotationVisibleWhileFollowingRiser(
  item: FloorPlanAnnotation,
  followedRiserIds: string[],
): boolean {
  if (item.type === "polyline" || item.type === "room") return true;
  if (followedRiserIds.length === 0) return true;
  if (item.type === "rectangle" || item.type === "circle") {
    if (!item.callout || calloutRiserIds(item.callout).length === 0) return true;
  }
  return followedRiserIds.some((id) => annotationHasRiser(item, id));
}

/** Ribbon label for zero, one, or many followed catalog instances. */
export function formatFollowedRisersSummary(
  types: MechanicalRiserTypeDto[],
  risers: MechanicalRiserDto[],
  followedRiserIds: string[],
): string {
  if (followedRiserIds.length === 0) return "Follow riser";
  const followed = followedRiserIds
    .map((id) => risers.find((riser) => riser.id === id))
    .filter((riser): riser is MechanicalRiserDto => riser != null);
  if (followed.length === 0) return "Follow riser";
  if (followed.length === 1) {
    const type = types.find((item) => item.id === followed[0]!.typeId);
    return formatMechanicalRiserLabel(
      type?.name ?? "Riser",
      followed[0]!.label,
    );
  }
  const labels = new Set(followed.map((riser) => riser.label));
  if (labels.size === 1) {
    return `${followed[0]!.label} (${followed.length} risers)`;
  }
  return `${followed.length} risers`;
}

/**
 * Map catalog ids after a type change. Identity when the row is kept;
 * a different id when the label already existed on the target type (merge).
 */
export type RiserIdRewrite = Record<string, string>;

export function rewriteRiserIds(
  ids: string[],
  rewrite: RiserIdRewrite,
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const mapped = rewrite[id] ?? id;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    next.push(mapped);
  }
  return next;
}

/**
 * After reclassifying catalog rows, retarget callouts and recolor boxes
 * whose assigned stacks are now a single type. Polylines are unchanged.
 */
export function applyRiserReclassifyToAnnotations(
  annotations: FloorPlanAnnotation[],
  rewrite: RiserIdRewrite,
  types: MechanicalRiserTypeDto[],
  risers: MechanicalRiserDto[],
): FloorPlanAnnotation[] {
  const keys = Object.keys(rewrite);
  if (keys.length === 0) return annotations;
  const affected = new Set(keys);
  return annotations.map((item) => {
    if (item.type !== "rectangle" && item.type !== "circle") return item;
    if (!item.callout) return item;
    const ids = calloutRiserIds(item.callout);
    if (!ids.some((id) => affected.has(id))) return item;
    const nextIds = rewriteRiserIds(ids, rewrite);
    const callout: FloorPlanCallout = {
      ...item.callout,
      riserId: nextIds[0],
      riserIds: nextIds,
    };
    const resolved = nextIds
      .map((id) => lookupRiser(risers, id))
      .filter((riser): riser is MechanicalRiserDto => riser != null);
    const type = resolved[0]
      ? types.find((itemType) => itemType.id === resolved[0]!.typeId)
      : undefined;
    const sameType =
      type != null &&
      resolved.length === nextIds.length &&
      resolved.every((riser) => riser.typeId === type.id);
    if (type && sameType) {
      callout.typeId = type.id;
      callout.text = formatMechanicalRiserLabels(
        type,
        resolved.map((riser) => riser.label),
      );
      return { ...item, color: type.color, callout };
    }
    return { ...item, callout };
  });
}

/** Keep only the chosen catalog instances on a copied callout. */
export function narrowCalloutToRisers(
  callout: FloorPlanCallout,
  riserIds: string[],
  types: MechanicalRiserTypeDto[],
  risers: MechanicalRiserDto[],
): FloorPlanCallout {
  const allowed = new Set(calloutRiserIds(callout));
  const nextIds = riserIds.filter((id) => allowed.has(id));
  if (nextIds.length === 0) return { ...callout };
  const next: FloorPlanCallout = {
    ...callout,
    riserId: nextIds[0],
    riserIds: nextIds,
  };
  const resolved = nextIds
    .map((id) => lookupRiser(risers, id))
    .filter((riser): riser is MechanicalRiserDto => riser != null);
  const type = resolved[0]
    ? types.find((item) => item.id === resolved[0]!.typeId)
    : undefined;
  const sameType =
    type != null &&
    resolved.length === nextIds.length &&
    resolved.every((riser) => riser.typeId === type.id);
  if (type && sameType) {
    next.text = formatMechanicalRiserLabels(
      type,
      resolved.map((riser) => riser.label),
    );
    next.typeId = type.id;
  }
  return next;
}

/** Keep only the followed instance on a copied callout. */
export function narrowCalloutToRiser(
  callout: FloorPlanCallout,
  riserId: string,
  types: MechanicalRiserTypeDto[],
  risers: MechanicalRiserDto[],
): FloorPlanCallout {
  return narrowCalloutToRisers(callout, [riserId], types, risers);
}

export type FollowRiserGroup = {
  type: MechanicalRiserTypeDto;
  risers: MechanicalRiserDto[];
};

/** Catalog instances grouped by type, open stacks first, then numeric label. */
export function groupRisersForFollowMenu(
  types: MechanicalRiserTypeDto[],
  risers: MechanicalRiserDto[],
): FollowRiserGroup[] {
  return types
    .map((type) => {
      const ofType = risers
        .filter((riser) => riser.typeId === type.id)
        .sort((a, b) => {
          const done = Number(riserIsCompleted(a)) - Number(riserIsCompleted(b));
          if (done !== 0) return done;
          return compareRiserLabels(a.label, b.label);
        });
      return { type, risers: ofType };
    })
    .filter((group) => group.risers.length > 0);
}

/** Unique catalog ids tagged on box callouts, first-seen order. */
export function taggedRiserIdsFromAnnotations(
  annotations: FloorPlanAnnotation[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of annotations) {
    if (item.type !== "rectangle" && item.type !== "circle") continue;
    if (!item.callout) continue;
    for (const id of calloutRiserIds(item.callout)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export type InventoryRiserEntry = MechanicalRiserDto & {
  /** True when this floor already has a saved tag for the riser. */
  approved: boolean;
};

export type TaggedRiserTypeGroup = {
  type: MechanicalRiserTypeDto;
  risers: InventoryRiserEntry[];
};

export type TaggedRiserFloorGroup = {
  floorNumber: number;
  current: boolean;
  types: TaggedRiserTypeGroup[];
};

function sortInventoryRisers(
  entries: InventoryRiserEntry[],
): InventoryRiserEntry[] {
  return [...entries].sort((a, b) => {
    const approved = Number(b.approved) - Number(a.approved);
    if (approved !== 0) return approved;
    return compareRiserLabels(a.label, b.label);
  });
}

function typesFromInventoryRisers(
  entries: InventoryRiserEntry[],
  types: MechanicalRiserTypeDto[],
): TaggedRiserTypeGroup[] {
  const byType = new Map<string, InventoryRiserEntry[]>();
  for (const entry of entries) {
    const list = byType.get(entry.typeId) ?? [];
    list.push(entry);
    byType.set(entry.typeId, list);
  }
  return types
    .filter((type) => byType.has(type.id))
    .map((type) => ({
      type,
      risers: sortInventoryRisers(byType.get(type.id) ?? []),
    }));
}

function inventoryRisersForFloor(
  planIds: string[],
  annotations: FloorPlanAnnotation[],
  pendingIds: string[],
  extraApprovedIds: string[],
  followSkipped: FloorPlanFollowSkip[],
  risers: MechanicalRiserDto[],
): InventoryRiserEntry[] {
  const taggedIds = taggedRiserIdsFromAnnotations(annotations);
  const approvedIds = [...taggedIds];
  const seenApproved = new Set(taggedIds);
  for (const id of extraApprovedIds) {
    if (seenApproved.has(id)) continue;
    seenApproved.add(id);
    approvedIds.push(id);
  }
  const entries: InventoryRiserEntry[] = [];
  const seen = new Set<string>();

  for (const id of approvedIds) {
    const riser = risers.find((item) => item.id === id);
    if (!riser) continue;
    seen.add(id);
    entries.push({ ...riser, approved: true });
  }

  for (const id of pendingIds) {
    if (seen.has(id)) continue;
    const riser = risers.find((item) => item.id === id);
    if (!riser || riserIsCompleted(riser)) continue;
    const skippedEverywhere =
      planIds.length > 0 &&
      planIds.every((planId) => followSkipHas(followSkipped, planId, id));
    if (skippedEverywhere) continue;
    seen.add(id);
    entries.push({ ...riser, approved: false });
  }

  return entries;
}

/**
 * Tagged callouts grouped by floor number, then legend type, then label.
 * Same floorNumber from multiple families is merged. Empty floors stay so a
 * missing tag on the ground floor is visible.
 */
export function groupTaggedRisersByFloor(
  floors: Array<{
    planId?: string;
    floorNumber: number;
    current?: boolean;
    annotations: FloorPlanAnnotation[];
  }>,
  types: MechanicalRiserTypeDto[],
  risers: MechanicalRiserDto[],
  options?: {
    followSkipped?: FloorPlanFollowSkip[];
    extraApprovedIdsByFloor?: Record<number, string[]>;
  },
): TaggedRiserFloorGroup[] {
  const followSkipped = options?.followSkipped ?? [];
  const extraApprovedIdsByFloor = options?.extraApprovedIdsByFloor ?? {};
  const merged = new Map<
    number,
    { current: boolean; annotations: FloorPlanAnnotation[]; planIds: string[] }
  >();
  for (const floor of floors) {
    const existing = merged.get(floor.floorNumber);
    if (!existing) {
      merged.set(floor.floorNumber, {
        current: floor.current === true,
        annotations: [...floor.annotations],
        planIds: floor.planId ? [floor.planId] : [],
      });
      continue;
    }
    existing.current = existing.current || floor.current === true;
    existing.annotations.push(...floor.annotations);
    if (floor.planId && !existing.planIds.includes(floor.planId)) {
      existing.planIds.push(floor.planId);
    }
  }
  const sortedFloors = [...merged.entries()].sort((a, b) => a[0] - b[0]);
  return sortedFloors.map(([floorNumber, entry], index) => {
    const below = index > 0 ? sortedFloors[index - 1] : undefined;
    const pendingIds = below
      ? taggedRiserIdsFromAnnotations(below[1].annotations)
      : [];
    return {
      floorNumber,
      current: entry.current,
      types: typesFromInventoryRisers(
        inventoryRisersForFloor(
          entry.planIds,
          entry.annotations,
          pendingIds,
          extraApprovedIdsByFloor[floorNumber] ?? [],
          followSkipped,
          risers,
        ),
        types,
      ),
    };
  });
}

export type MechanicalTypeSyncPlan = {
  upserts: MechanicalRiserTypeDto[];
  deleteIds: string[];
  blockedNames: string[];
};

/**
 * Diff the mechanical rows of a preset list against saved types.
 * Types still referenced by numbered risers cannot be deleted.
 */
export function planMechanicalTypeSync(
  incomingPresets: DrawColorPreset[],
  existing: MechanicalRiserTypeDto[],
  typeIdsInUse: Iterable<string>,
): MechanicalTypeSyncPlan {
  const inUse = new Set(typeIdsInUse);
  const incoming = mechanicalTypesFromPresets(incomingPresets);
  const incomingIds = new Set(incoming.map((type) => type.id).filter(Boolean));

  const upserts: MechanicalRiserTypeDto[] = incoming.map((type, index) => ({
    ...type,
    sortOrder: index,
  }));

  const deleteIds: string[] = [];
  const blockedNames: string[] = [];
  for (const type of existing) {
    if (incomingIds.has(type.id)) continue;
    if (inUse.has(type.id)) {
      blockedNames.push(type.name);
      continue;
    }
    deleteIds.push(type.id);
  }

  return { upserts, deleteIds, blockedNames };
}
