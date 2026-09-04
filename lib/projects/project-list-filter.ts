/** Client-safe project list filters for Entities → Projects merge QA. */

import {
  resolveProjectScope,
  type ProjectScope,
} from "@/lib/email-analysis/project-highlight-shared";
import { normalizeProjectPhase } from "@/lib/projects/project-phase";
import { splitProjectMultiValue } from "@/lib/projects/project-multi-values";
import {
  normalizeProjectYearHint,
  parseProjectYearRange,
  projectYearRangeCovers,
  projectYearRangeStart,
} from "@/lib/projects/project-year-range";

export type PresenceFilter = "any" | "set" | "missing";

export type ProjectListFilters = {
  scope: "all" | ProjectScope;
  year: "all" | "missing" | string;
  phase: "all" | "missing" | string;
  contractor: PresenceFilter;
  location: PresenceFilter;
  equipment: PresenceFilter;
  completeness: "all" | "incomplete" | "complete";
  board: "all" | "mentioned" | "not_mentioned";
};

export const EMPTY_PROJECT_LIST_FILTERS: ProjectListFilters = {
  scope: "all",
  year: "all",
  phase: "all",
  contractor: "any",
  location: "any",
  equipment: "any",
  completeness: "all",
  board: "all",
};

type ProjectFilterable = {
  displayName: string;
  name?: string | null;
  year_hint?: string | null;
  phase?: string | null;
  contractor?: string | null;
  location?: string | null;
  equipment_mentions?: string | null;
  aliases?: string[];
  scope?: ProjectScope | null;
  boardReportCount?: number;
};

const METADATA_FIELDS = [
  "year_hint",
  "phase",
  "contractor",
  "location",
  "equipment_mentions",
] as const;

export function projectFieldIsSet(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function projectYearIsSet(value: string | null | undefined): boolean {
  return parseProjectYearRange(value) != null;
}

function projectPhaseIsSet(value: string | null | undefined): boolean {
  return normalizeProjectPhase(value) != null;
}

/** How many of year / phase / contractor / location / equipment are filled. */
export function projectMetadataFillCount(project: ProjectFilterable): number {
  let filled = 0;
  if (projectYearIsSet(project.year_hint)) filled += 1;
  if (projectPhaseIsSet(project.phase)) filled += 1;
  if (projectFieldIsSet(project.contractor)) filled += 1;
  if (projectFieldIsSet(project.location)) filled += 1;
  if (projectFieldIsSet(project.equipment_mentions)) filled += 1;
  return filled;
}

export function projectHasCompleteMetadata(project: ProjectFilterable): boolean {
  return projectMetadataFillCount(project) === METADATA_FIELDS.length;
}

export function hasActiveProjectListFilters(filters: ProjectListFilters): boolean {
  return (
    filters.scope !== "all" ||
    filters.year !== "all" ||
    filters.phase !== "all" ||
    filters.contractor !== "any" ||
    filters.location !== "any" ||
    filters.equipment !== "any" ||
    filters.completeness !== "all" ||
    filters.board !== "all"
  );
}

function matchesPresence(
  value: string | null | undefined,
  filter: PresenceFilter,
): boolean {
  if (filter === "any") return true;
  const set = projectFieldIsSet(value);
  return filter === "set" ? set : !set;
}

function collectUniqueValues(raw: string | null | undefined): string[] {
  return splitProjectMultiValue(raw);
}

export function matchesProjectListFilters(
  project: ProjectFilterable,
  filters: ProjectListFilters,
): boolean {
  if (filters.scope !== "all") {
    const scope = resolveProjectScope({
      location: project.location ?? null,
      scope: project.scope ?? null,
    }) ?? "unknown";
    if (scope !== filters.scope) return false;
  }

  if (filters.year === "missing") {
    if (projectYearIsSet(project.year_hint)) return false;
  } else if (filters.year !== "all") {
    const filterRange = parseProjectYearRange(filters.year);
    if (!filterRange) return false;
    if (filterRange.start === filterRange.end) {
      if (!projectYearRangeCovers(project.year_hint, filterRange.start)) {
        return false;
      }
    } else if (
      normalizeProjectYearHint(project.year_hint) !==
      normalizeProjectYearHint(filters.year)
    ) {
      return false;
    }
  }

  if (filters.phase === "missing") {
    if (projectPhaseIsSet(project.phase)) return false;
  } else if (filters.phase !== "all") {
    const wanted = normalizeProjectPhase(filters.phase);
    const phases = collectUniqueValues(project.phase);
    if (
      !wanted ||
      !phases.some((phase) => normalizeProjectPhase(phase) === wanted)
    ) {
      return false;
    }
  }

  if (!matchesPresence(project.contractor, filters.contractor)) return false;
  if (!matchesPresence(project.location, filters.location)) return false;
  if (!matchesPresence(project.equipment_mentions, filters.equipment)) {
    return false;
  }

  if (filters.completeness === "complete" && !projectHasCompleteMetadata(project)) {
    return false;
  }
  if (filters.completeness === "incomplete" && projectHasCompleteMetadata(project)) {
    return false;
  }

  if (filters.board === "mentioned" && (project.boardReportCount ?? 0) <= 0) {
    return false;
  }
  if (filters.board === "not_mentioned" && (project.boardReportCount ?? 0) > 0) {
    return false;
  }

  return true;
}

export function projectMatchesListSearch(
  project: ProjectFilterable,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    project.displayName,
    project.name,
    project.year_hint,
    project.phase,
    project.contractor,
    project.location,
    project.equipment_mentions,
    ...(project.aliases ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

export function collectProjectFilterOptions(projects: readonly ProjectFilterable[]): {
  years: string[];
  phases: string[];
} {
  const years = new Set<string>();
  const phases = new Set<string>();
  for (const project of projects) {
    const year = normalizeProjectYearHint(project.year_hint);
    if (year) years.add(year);
    const phase = normalizeProjectPhase(project.phase);
    if (phase) phases.add(phase);
  }
  return {
    years: [...years].sort((a, b) => {
      const aStart = projectYearRangeStart(a) ?? 0;
      const bStart = projectYearRangeStart(b) ?? 0;
      if (aStart !== bStart) return bStart - aStart;
      return b.localeCompare(a, undefined, { numeric: true });
    }),
    phases: [...phases].sort((a, b) => a.localeCompare(b)),
  };
}
