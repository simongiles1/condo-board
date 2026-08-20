/** Client-safe project-registry field evidence types (no DB imports). */

import type {
  ProjectEntityCard,
  ProjectHighlightExtraction,
} from "@/lib/email-analysis/project-highlight-shared";
import {
  normalizeProjectNameKey,
  normalizeProjectYearHint,
  projectMultiValueContains,
  splitProjectMultiValue,
} from "@/lib/projects/project-multi-values";

export const PROJECT_EVIDENCE_FIELDS = [
  "source_emails",
  "name",
  "name_alias",
  "year_hint",
  "phase",
  "contractor",
  "location",
  "equipment_mentions",
] as const;

export type ProjectEvidenceField = (typeof PROJECT_EVIDENCE_FIELDS)[number];

export type ProjectEvidenceMatchReason =
  | "fingerprint"
  | "highlight"
  | "in_body";

export type ProjectEvidenceEmailSummary = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  preview: string;
  matchReasons: ProjectEvidenceMatchReason[];
};

export type ProjectEvidencePayload = {
  field: ProjectEvidenceField;
  value: string;
  /** Strings to highlight in the body (source-emails uses every project field). */
  needles: string[];
  project: {
    id: string;
    displayName: string;
  };
  emails: ProjectEvidenceEmailSummary[];
  matchedCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export const PROJECT_EVIDENCE_DEFAULT_PAGE_SIZE = 25;
export const PROJECT_EVIDENCE_MAX_PAGE_SIZE = 100;

export function isProjectEvidenceField(
  value: string,
): value is ProjectEvidenceField {
  return (PROJECT_EVIDENCE_FIELDS as readonly string[]).includes(value);
}

export function projectEvidenceFieldLabel(field: ProjectEvidenceField): string {
  if (field === "source_emails") return "Source emails";
  if (field === "name_alias") return "Alias";
  if (field === "year_hint") return "Year";
  if (field === "phase") return "Phase";
  if (field === "contractor") return "Contractor";
  if (field === "location") return "Location";
  if (field === "equipment_mentions") return "Equipment";
  return "Name";
}

export function projectEvidenceMatchReasonLabel(
  reason: ProjectEvidenceMatchReason,
): string {
  switch (reason) {
    case "fingerprint":
      return "Project card";
    case "highlight":
      return "Highlight";
    case "in_body":
      return "In body";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/** Case-insensitive ranges of `value` in `text` (non-overlapping, left to right). */
export function findCaseInsensitiveRanges(
  text: string,
  value: string,
): Array<{ start: number; end: number }> {
  const needle = value.trim();
  if (!text || !needle) return [];
  const hay = text.toLowerCase();
  const find = needle.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from < hay.length) {
    const start = hay.indexOf(find, from);
    if (start < 0) break;
    out.push({ start, end: start + needle.length });
    from = start + Math.max(1, needle.length);
  }
  return out;
}

/** Non-overlapping ranges for every needle; longer hits win when they overlap. */
export function findNeedleRanges(
  text: string,
  needles: string[],
): Array<{ start: number; end: number }> {
  const hits: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();
  for (const raw of needles) {
    const needle = raw.trim();
    if (!needle) continue;
    const key = needle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(...findCaseInsensitiveRanges(text, needle));
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Array<{ start: number; end: number }> = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.start < lastEnd) continue;
    out.push(hit);
    lastEnd = hit.end;
  }
  return out;
}

/** Distinct highlight strings for a project's source-email panel (no year). */
export function collectProjectSourceNeedles(project: {
  name?: string | null;
  displayName?: string | null;
  aliases?: string[] | null;
  phase?: string | null;
  contractor?: string | null;
  location?: string | null;
  equipment_mentions?: string | null;
}): string[] {
  const raw = [
    project.name,
    project.displayName,
    ...(project.aliases ?? []),
    project.phase,
    ...splitProjectMultiValue(project.contractor),
    ...splitProjectMultiValue(project.location),
    ...splitProjectMultiValue(project.equipment_mentions),
  ];
  return dedupeNeedles(raw);
}

/** Work-name only — used to decide whether an email belongs to this project. */
export function collectProjectIdentityNeedles(project: {
  name?: string | null;
  aliases?: string[] | null;
}): string[] {
  return dedupeNeedles([project.name, ...(project.aliases ?? [])]);
}

function dedupeNeedles(raw: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw) {
    const trimmed = part?.trim() ?? "";
    if (trimmed.length < 3) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Signature leftovers like "Shawna" are not project evidence. */
export function isThinProjectEvidenceBody(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  const words = normalized.split(" ").filter(Boolean);
  return normalized.length < 40 || words.length < 8;
}

export function bodyContainsIdentityNeedle(
  text: string,
  identityNeedles: string[],
): boolean {
  return identityNeedles.some(
    (needle) => findCaseInsensitiveRanges(text, needle).length > 0,
  );
}

/**
 * Include when pass-3 minted this identity, or the authored body names the
 * work. Thin signature stubs stay out unless they contain the work-name.
 */
export function emailBelongsInProjectSourceEvidence(params: {
  authoredBody: string;
  pass3CardMatches: boolean;
  identityNeedles: string[];
}): boolean {
  const hasWorkName = bodyContainsIdentityNeedle(
    params.authoredBody,
    params.identityNeedles,
  );
  if (hasWorkName) return true;
  if (!params.pass3CardMatches) return false;
  return !isThinProjectEvidenceBody(params.authoredBody);
}

function namesMatch(left: string | null | undefined, right: string): boolean {
  const key = normalizeProjectNameKey(right);
  if (!key) return false;
  return normalizeProjectNameKey(left) === key;
}

function yearsMatch(left: string | null | undefined, right: string): boolean {
  const trimmed = right.trim();
  if (!trimmed) return false;
  const leftYear = normalizeProjectYearHint(left);
  const rightYear = normalizeProjectYearHint(trimmed);
  if (leftYear && rightYear) return leftYear === rightYear;
  return (left ?? "").trim().toLowerCase() === trimmed.toLowerCase();
}

function phasesMatch(left: string | null | undefined, right: string): boolean {
  const key = right.trim().toLowerCase();
  if (!key) return false;
  return (left ?? "").trim().toLowerCase() === key;
}

export function projectCardMatchesEvidenceValue(
  card: ProjectEntityCard,
  field: ProjectEvidenceField,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (field === "contractor") {
    return projectMultiValueContains(card.contractor, trimmed);
  }
  if (field === "location") {
    return projectMultiValueContains(card.location, trimmed);
  }
  if (field === "equipment_mentions") {
    return projectMultiValueContains(card.equipment_mentions, trimmed);
  }
  if (field === "year_hint") {
    return yearsMatch(card.year_hint, trimmed);
  }
  if (field === "phase") {
    return phasesMatch(card.phase, trimmed);
  }
  if (field === "name") {
    return namesMatch(card.name, trimmed);
  }
  if (field === "source_emails") return false;
  // Alias click: this string was originally a card name, then folded on merge.
  if (namesMatch(card.name, trimmed)) return true;
  return (card.aliases ?? []).some((alias) => namesMatch(alias, trimmed));
}

export function projectHighlightMatchesEvidenceValue(
  extraction: ProjectHighlightExtraction,
  field: ProjectEvidenceField,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (field === "equipment_mentions" || field === "source_emails") return false;
  if (field === "contractor") {
    return extraction.contractors.some((contractor) =>
      projectMultiValueContains(contractor, trimmed),
    );
  }
  if (field === "location") {
    return extraction.locations.some((location) =>
      projectMultiValueContains(location, trimmed),
    );
  }
  if (field === "year_hint") {
    return extraction.year_hints.some((year) => yearsMatch(year, trimmed));
  }
  if (field === "phase") {
    return extraction.phases.some((phase) => phasesMatch(phase, trimmed));
  }
  return extraction.project_names.some((name) => namesMatch(name, trimmed));
}

export function splitProjectEvidenceNeedles(
  field: ProjectEvidenceField,
  value: string,
): string[] {
  if (field === "source_emails") return [];
  if (
    field === "contractor" ||
    field === "location" ||
    field === "equipment_mentions"
  ) {
    return splitProjectMultiValue(value);
  }
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (field === "year_hint") {
    const year = normalizeProjectYearHint(trimmed);
    return year && year !== trimmed ? [trimmed, year] : [trimmed];
  }
  return [trimmed];
}
