/** Client-safe project list filters for Entities → Projects merge QA. */

import {
  resolveProjectScope,
  type ProjectScope,
} from "@/lib/email-analysis/project-highlight-shared";
import { splitProjectMultiValue } from "@/lib/projects/project-multi-values";

export type PresenceFilter = "any" | "set" | "missing";

export type ProjectListFilters = {
  scope: "all" | ProjectScope;
  year: "all" | "missing" | string;
  phase: "all" | "missing" | string;
  contractor: PresenceFilter;
  location: PresenceFilter;
  equipment: PresenceFilter;
  completeness: "all" | "incomplete" | "complete";
};

export const EMPTY_PROJECT_LIST_FILTERS: ProjectListFilters = {
  scope: "all",
  year: "all",
  phase: "all",
  contractor: "any",
  location: "any",
  equipment: "any",
  completeness: "all",
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

/** How many of year / phase / contractor / location / equipment are filled. */
export function projectMetadataFillCount(project: ProjectFilterable): number {
  let filled = 0;
  for (const field of METADATA_FIELDS) {
    if (projectFieldIsSet(project[field])) filled += 1;
  }
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
    filters.completeness !== "all"
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
    if (projectFieldIsSet(project.year_hint)) return false;
  } else if (filters.year !== "all") {
    const years = collectUniqueValues(project.year_hint);
    if (!years.some((year) => year === filters.year)) return false;
  }

  if (filters.phase === "missing") {
    if (projectFieldIsSet(project.phase)) return false;
  } else if (filters.phase !== "all") {
    const phases = collectUniqueValues(project.phase);
    if (
      !phases.some(
        (phase) => phase.toLowerCase() === filters.phase.toLowerCase(),
      )
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
    for (const year of collectUniqueValues(project.year_hint)) years.add(year);
    for (const phase of collectUniqueValues(project.phase)) phases.add(phase);
  }
  return {
    years: [...years].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
    phases: [...phases].sort((a, b) => a.localeCompare(b)),
  };
}
