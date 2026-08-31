/** Client-safe project list sort helpers (no DB imports). */

import { projectMetadataFillCount } from "@/lib/projects/project-list-filter";
import { projectPhaseSortRank } from "@/lib/projects/project-phase";
import { projectYearRangeStart } from "@/lib/projects/project-year-range";

export type ProjectFingerprintListSort =
  | "mentions-desc"
  | "mentions-asc"
  | "name-asc"
  | "name-desc"
  | "year-desc"
  | "year-asc"
  | "phase-asc"
  | "completeness-asc"
  | "completeness-desc"
  | "board-desc"
  | "board-asc";

const PROJECT_FINGERPRINT_LIST_SORTS = new Set<ProjectFingerprintListSort>([
  "mentions-desc",
  "mentions-asc",
  "name-asc",
  "name-desc",
  "year-desc",
  "year-asc",
  "phase-asc",
  "completeness-asc",
  "completeness-desc",
  "board-desc",
  "board-asc",
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
  year_hint?: string | null;
  phase?: string | null;
  contractor?: string | null;
  location?: string | null;
  equipment_mentions?: string | null;
  boardReportCount?: number;
};

function firstYearValue(raw: string | null | undefined): number | null {
  return projectYearRangeStart(raw);
}

function compareMissingLast(
  a: number | null,
  b: number | null,
  direction: "asc" | "desc",
): number | null {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? a - b : b - a;
}

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
    case "year-asc":
    case "year-desc": {
      const yearCmp = compareMissingLast(
        firstYearValue(a.year_hint),
        firstYearValue(b.year_hint),
        sort === "year-asc" ? "asc" : "desc",
      );
      if (yearCmp) return yearCmp;
      return a.displayName.localeCompare(b.displayName);
    }
    case "phase-asc": {
      const phaseCmp = compareMissingLast(
        projectPhaseSortRank(a.phase),
        projectPhaseSortRank(b.phase),
        "asc",
      );
      if (phaseCmp) return phaseCmp;
      return a.displayName.localeCompare(b.displayName);
    }
    case "completeness-asc":
    case "completeness-desc": {
      const aFill = projectMetadataFillCount(a);
      const bFill = projectMetadataFillCount(b);
      if (aFill !== bFill) {
        return sort === "completeness-asc" ? aFill - bFill : bFill - aFill;
      }
      if (b.sourceEmailCount !== a.sourceEmailCount) {
        return b.sourceEmailCount - a.sourceEmailCount;
      }
      return a.displayName.localeCompare(b.displayName);
    }
    case "board-asc":
    case "board-desc": {
      const aBoard = a.boardReportCount ?? 0;
      const bBoard = b.boardReportCount ?? 0;
      if (aBoard !== bBoard) {
        return sort === "board-asc" ? aBoard - bBoard : bBoard - aBoard;
      }
      if (b.sourceEmailCount !== a.sourceEmailCount) {
        return b.sourceEmailCount - a.sourceEmailCount;
      }
      return a.displayName.localeCompare(b.displayName);
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
