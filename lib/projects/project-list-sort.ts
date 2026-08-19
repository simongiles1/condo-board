/** Client-safe project list sort helpers (no DB imports). */

export type ProjectFingerprintListSort =
  | "mentions-desc"
  | "mentions-asc"
  | "name-asc"
  | "name-desc";

const PROJECT_FINGERPRINT_LIST_SORTS = new Set<ProjectFingerprintListSort>([
  "mentions-desc",
  "mentions-asc",
  "name-asc",
  "name-desc",
]);

export function parseProjectFingerprintListSort(
  raw: string | null | undefined,
): ProjectFingerprintListSort {
  if (
    raw &&
    PROJECT_FINGERPRINT_LIST_SORTS.has(raw as ProjectFingerprintListSort)
  ) {
    return raw as ProjectFingerprintListSort;
  }
  return "mentions-desc";
}

type ProjectSortable = {
  displayName: string;
  sourceEmailCount: number;
};

export function compareProjectFingerprintSummaries<T extends ProjectSortable>(
  a: T,
  b: T,
  sort: ProjectFingerprintListSort,
): number {
  switch (sort) {
    case "mentions-asc":
      if (a.sourceEmailCount !== b.sourceEmailCount) {
        return a.sourceEmailCount - b.sourceEmailCount;
      }
      return a.displayName.localeCompare(b.displayName);
    case "name-asc": {
      const nameCmp = a.displayName.localeCompare(b.displayName);
      if (nameCmp !== 0) return nameCmp;
      return b.sourceEmailCount - a.sourceEmailCount;
    }
    case "name-desc": {
      const nameCmp = b.displayName.localeCompare(a.displayName);
      if (nameCmp !== 0) return nameCmp;
      return b.sourceEmailCount - a.sourceEmailCount;
    }
    case "mentions-desc":
    default:
      if (b.sourceEmailCount !== a.sourceEmailCount) {
        return b.sourceEmailCount - a.sourceEmailCount;
      }
      return a.displayName.localeCompare(b.displayName);
  }
}

export function sortProjectFingerprintSummaries<T extends ProjectSortable>(
  projects: T[],
  sort: ProjectFingerprintListSort,
): T[] {
  return [...projects].sort((a, b) =>
    compareProjectFingerprintSummaries(a, b, sort),
  );
}
