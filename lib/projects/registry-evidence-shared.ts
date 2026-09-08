/** Client-safe project-registry field evidence types (no DB imports). */

import type {
  ProjectEntityCard,
  ProjectHighlightExtraction,
} from "@/lib/email-analysis/project-highlight-shared";
import { phasesMatch } from "@/lib/projects/project-phase";
import {
  normalizeProjectNameKey,
  projectMultiValueContains,
  splitProjectMultiValue,
} from "@/lib/projects/project-multi-values";
import {
  normalizeProjectYearHint,
  parseProjectYearRange,
  yearsMatch,
} from "@/lib/projects/project-year-range";

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
  needles?: string[];
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
  if (field === "year_hint") return "Years";
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

export function dedupeNeedles(raw: Array<string | null | undefined>): string[] {
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

/**
 * Action / work-type suffixes stripped to yield the core noun phrase / asset:
 * e.g. "TNR garage door replacement" -> "TNR garage door"
 *      "West Side Loading Bay Door - Scheduled Repairs" -> "West Side Loading Bay Door"
 */
const PROJECT_ACTION_SUFFIX_REGEX =
  /(?:\s+[-–—/]\s*|\s+)(?:emergency\s+|scheduled\s+|routine\s+|annual\s+|preventative\s+|preventive\s+)?(?:repair\s*(?:and|\/|&)\s*replacement|replacement\s*(?:and|\/|&)\s*repair|repairs?|replacements?|installations?|installs?|maintenance|upgrades?|inspections?|servic(?:e|es|ing)|retrofits?|works?|projects?|quotes?|proposals?|contracts?|audits?|investigations?|reviews?|malfunctions?|breakdowns?|testing)\s*$/i;

/**
 * Action / work-type prefixes stripped to yield the core noun phrase / asset:
 * e.g. "installation of a new TNR overhead garage door" -> "TNR overhead garage door"
 *      "Repair for Public Garage Door" -> "Public Garage Door"
 */
const PROJECT_ACTION_PREFIX_REGEX =
  /^(?:emergency\s+|scheduled\s+|routine\s+|annual\s+|preventative\s+|preventive\s+)?(?:repair\s*(?:and|\/|&)\s*replacement|replacement\s*(?:and|\/|&)\s*repair|repairs?|replacements?|installations?|installs?|maintenance|servic(?:e|es|ing)|retrofits?|inspections?|works?|reviews?|quotes?|proposals?|audits?|repaints?)\s+(?:of|for|to|at|on|in)\s+(?:(?:a|an|the)\s+)?(?:(?:new|faulty|damaged|broken|existing)\s+)?/i;

const PROJECT_LEADING_DESCRIPTOR_REGEX =
  /^(?:new|existing|proposed|damaged|faulty|broken)\s+/i;

const GENERIC_SINGLE_WORDS = new Set([
  "door",
  "doors",
  "work",
  "works",
  "repair",
  "repairs",
  "quote",
  "quotes",
  "unit",
  "units",
  "wall",
  "walls",
  "gate",
  "gates",
  "roof",
  "pipe",
  "pipes",
  "line",
  "lines",
  "pump",
  "pumps",
  "panel",
  "panels",
  "part",
  "parts",
]);

export function expandProjectNameNeedles(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates: string[] = [trimmed];

  // 1. Parentheses: "Overhead Door (OHD) Installation" -> "OHD", "Overhead Door Installation"
  const parenMatch = trimmed.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inside = parenMatch[1]?.trim();
    if (inside && inside.length >= 3) candidates.push(inside);
    const withoutParens = trimmed
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (withoutParens && withoutParens.length >= 3) {
      candidates.push(withoutParens);
    }
  }

  // 2. Dash/separator split: "West Side Loading Bay Door - Scheduled Repairs"
  if (/[-–—:]/.test(trimmed)) {
    const parts = trimmed
      .split(/\s*[-–—:]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (part.length >= 3) candidates.push(part);
    }
  }

  // 3. Prefix / suffix / descriptor stripped variants
  const queue = [...candidates];
  for (const item of queue) {
    if (PROJECT_ACTION_SUFFIX_REGEX.test(item)) {
      const stripped = item.replace(PROJECT_ACTION_SUFFIX_REGEX, "").trim();
      if (stripped.length >= 3) candidates.push(stripped);
    }
    if (PROJECT_ACTION_PREFIX_REGEX.test(item)) {
      const stripped = item.replace(PROJECT_ACTION_PREFIX_REGEX, "").trim();
      if (stripped.length >= 3) candidates.push(stripped);
    }
    if (PROJECT_LEADING_DESCRIPTOR_REGEX.test(item)) {
      const stripped = item.replace(PROJECT_LEADING_DESCRIPTOR_REGEX, "").trim();
      if (stripped.length >= 3) candidates.push(stripped);
    }
  }

  // Filter out bare generic single words that were stripped, keeping the original intact
  const filtered = candidates.filter((item) => {
    if (item.toLowerCase() === trimmed.toLowerCase()) return true;
    if (!item.includes(" ")) {
      if (GENERIC_SINGLE_WORDS.has(item.toLowerCase())) return false;
      if (item.length < 3) return false;
    }
    return true;
  });

  return dedupeNeedles(filtered);
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
  const needles = splitProjectEvidenceNeedles(field, value);
  if (needles.some((needle) => namesMatch(card.name, needle))) return true;
  return (card.aliases ?? []).some((alias) =>
    needles.some((needle) => namesMatch(alias, needle)),
  );
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
  const needles = splitProjectEvidenceNeedles(field, value);
  return extraction.project_names.some((name) =>
    needles.some((needle) => namesMatch(name, needle)),
  );
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
    const parsed = parseProjectYearRange(trimmed);
    const canonical = normalizeProjectYearHint(trimmed);
    const needles = [trimmed];
    if (canonical && canonical !== trimmed) needles.push(canonical);
    if (parsed) {
      needles.push(String(parsed.start));
      if (parsed.end !== parsed.start) needles.push(String(parsed.end));
    }
    return [...new Set(needles)];
  }
  if (field === "name" || field === "name_alias") {
    return expandProjectNameNeedles(trimmed);
  }
  return [trimmed];
}
