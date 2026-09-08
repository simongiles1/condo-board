/** Client-safe equipment list sort helpers (no DB imports). */

export type EquipmentRegistryListSort =
  | "mentions-desc"
  | "mentions-asc"
  | "name-asc"
  | "name-desc";

const EQUIPMENT_REGISTRY_LIST_SORTS = new Set<EquipmentRegistryListSort>([
  "mentions-desc",
  "mentions-asc",
  "name-asc",
  "name-desc",
]);

export function parseEquipmentRegistryListSort(
  raw: string | null | undefined,
): EquipmentRegistryListSort {
  if (
    raw &&
    EQUIPMENT_REGISTRY_LIST_SORTS.has(raw as EquipmentRegistryListSort)
  ) {
    return raw as EquipmentRegistryListSort;
  }
  return "mentions-desc";
}

type EquipmentSortable = {
  displayName: string;
  mentionCount: number;
};

export function compareEquipmentRegistrySummaries<T extends EquipmentSortable>(
  a: T,
  b: T,
  sort: EquipmentRegistryListSort,
): number {
  switch (sort) {
    case "mentions-asc":
      if (a.mentionCount !== b.mentionCount) {
        return a.mentionCount - b.mentionCount;
      }
      return a.displayName.localeCompare(b.displayName);
    case "name-asc": {
      const nameCmp = a.displayName.localeCompare(b.displayName);
      if (nameCmp !== 0) return nameCmp;
      return b.mentionCount - a.mentionCount;
    }
    case "name-desc": {
      const nameCmp = b.displayName.localeCompare(a.displayName);
      if (nameCmp !== 0) return nameCmp;
      return b.mentionCount - a.mentionCount;
    }
    case "mentions-desc":
    default:
      if (b.mentionCount !== a.mentionCount) {
        return b.mentionCount - a.mentionCount;
      }
      return a.displayName.localeCompare(b.displayName);
  }
}

export function sortEquipmentRegistrySummaries<T extends EquipmentSortable>(
  equipment: T[],
  sort: EquipmentRegistryListSort,
): T[] {
  return [...equipment].sort((a, b) =>
    compareEquipmentRegistrySummaries(a, b, sort),
  );
}
