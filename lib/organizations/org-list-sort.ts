/** Client-safe org list sort helpers (no DB imports). */

export type OrgFingerprintListSort =
  | "mentions-desc"
  | "mentions-asc"
  | "name-asc"
  | "name-desc";

const ORG_FINGERPRINT_LIST_SORTS = new Set<OrgFingerprintListSort>([
  "mentions-desc",
  "mentions-asc",
  "name-asc",
  "name-desc",
]);

export function parseOrgFingerprintListSort(
  raw: string | null | undefined,
): OrgFingerprintListSort {
  if (raw && ORG_FINGERPRINT_LIST_SORTS.has(raw as OrgFingerprintListSort)) {
    return raw as OrgFingerprintListSort;
  }
  return "mentions-desc";
}

type OrgSortable = {
  displayName: string;
  sourceEmailCount: number;
};

export function compareOrgFingerprintSummaries<T extends OrgSortable>(
  a: T,
  b: T,
  sort: OrgFingerprintListSort,
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

export function sortOrgFingerprintSummaries<T extends OrgSortable>(
  organizations: T[],
  sort: OrgFingerprintListSort,
): T[] {
  return [...organizations].sort((a, b) =>
    compareOrgFingerprintSummaries(a, b, sort),
  );
}
