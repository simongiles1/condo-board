/**
 * Project-mention candidate retrieval + resolution (no DB).
 *
 * Search document = name + formal aliases + contractor + year + location.
 * Name matching uses name+aliases only so a contractor-as-name mention
 * cannot attach through the contractor field.
 *
 * When the mention carries a resolved anchor, candidates are hard-filtered
 * by (anchor_type + anchor_id) before ranking. NULL anchors never match
 * other NULL anchors. Completed work is locked except for an explicit
 * identifier (quote / PO / invoice) or a 90-day trailing invoice from the
 * same contractor on the same anchor.
 *
 * The retriever returns at most five lexical hits. Attach is
 * decideProjectMentionResolution's job:
 *   extracted anchor type without a canonical id → unresolved ambiguous_equipment
 *   unique identity_key → confirmed
 *   unique exact name or alias, year-compatible (or trailing invoice) → confirmed
 *   unique work-name equivalent → provisional
 *   same-anchor hits all completed and outside the grace window → completed_locked
 *   name hits exist but none share the mention's anchor → anchor_mismatch
 *   2+ remaining after the year filter → unresolved
 *   hits exist but all fail year overlap → unresolved year_mismatch
 */

import { projectWorkNameMatchesPolicy } from "@/lib/projects/identity-match";
import {
  normalizeProjectNameKey,
  splitProjectMultiValue,
} from "@/lib/projects/project-multi-values";
import {
  parseProjectYearRange,
  projectYearRangesOverlap,
} from "@/lib/projects/project-year-range";

export const PROJECT_MENTION_SHORTLIST_LIMIT = 5;
export const PROJECT_TRAILING_INVOICE_DAYS = 90;

export const PROJECT_TIERS = [
  "service_call",
  "incident",
  "capital_project",
] as const;
export type ProjectTier = (typeof PROJECT_TIERS)[number];

export const PROJECT_ANCHOR_TYPES = [
  "equipment",
  "building_area",
  "service_category",
  "provisional_equipment",
] as const;
export type ProjectAnchorType = (typeof PROJECT_ANCHOR_TYPES)[number];

export const PROJECT_MENTION_ANCHOR_TYPES = [
  "equipment",
  "building_area",
  "service_category",
] as const;
export type ProjectMentionAnchorType =
  (typeof PROJECT_MENTION_ANCHOR_TYPES)[number];

export type ProjectMentionNameMatch = "exact" | "alias" | "work";

export type ProjectMentionLifecycle =
  | "open"
  | "explicit_id"
  | "trailing_invoice"
  | "completed_locked";

export type ProjectMentionSearchDocument = {
  id: string;
  identityKey: string;
  name: string | null;
  aliases: string[];
  contractor: string | null;
  yearHint: string | null;
  location: string | null;
  tier?: ProjectTier;
  anchorType?: ProjectAnchorType | null;
  anchorId?: string | null;
  equipmentIds?: string[];
  phase?: string | null;
  completedAt?: string | null;
};

export type ProjectMentionQuery = {
  rawName: string;
  contractor: string | null;
  yearHint: string | null;
  location: string | null;
  anchorType?: ProjectMentionAnchorType | ProjectAnchorType | null;
  anchorId?: string | null;
  explicitIdentifier?: string | null;
  mentionDate?: string | null;
};

export type ProjectLexicalCandidate = {
  id: string;
  nameMatch: ProjectMentionNameMatch;
  yearCompatible: boolean;
  score: number;
  anchorCompatible?: boolean;
  lifecycle?: ProjectMentionLifecycle;
  isTrailingInvoice?: boolean;
};

export type ProjectMentionResolveSignals = {
  uniqueIdentityMatches: string[];
  lexicalCandidates: ProjectLexicalCandidate[];
  /** Extracted an anchor type (or requireAnchor) but no canonical id. */
  missingAnchor?: boolean;
};

export type ProjectMentionResolveDecision = {
  status: "unresolved" | "provisional" | "confirmed";
  projectId: string | null;
  reason: string;
};

const NAME_MATCH_SCORE: Record<ProjectMentionNameMatch, number> = {
  exact: 100,
  alias: 90,
  work: 70,
};

const FORMAL_ID_RE =
  /\b(?:quote|qte|quotation|rfp|po|p\.o\.|invoice|inv)\s*#?\s*([A-Z0-9][-A-Z0-9/]{1,24})/gi;

const COMPLETED_PHASES = new Set(["complete", "completed", "cancelled"]);

/** Name + aliases + contractor + year + location. Not equipment. */
export function formatProjectMentionSearchDocument(
  doc: ProjectMentionSearchDocument,
): string {
  return [
    doc.name,
    ...doc.aliases,
    doc.contractor,
    doc.yearHint,
    doc.location,
  ]
    .map((part) => part?.trim() || "")
    .filter(Boolean)
    .join("\n");
}

export function projectMentionYearCompatible(
  mentionYear: string | null | undefined,
  entityYear: string | null | undefined,
): boolean {
  const mentionRange = parseProjectYearRange(mentionYear);
  const entityRange = parseProjectYearRange(entityYear);
  if (!mentionRange || !entityRange) return true;
  return projectYearRangesOverlap(mentionRange, entityRange);
}

export function classifyProjectMentionNameMatch(
  rawName: string,
  doc: Pick<ProjectMentionSearchDocument, "name" | "aliases">,
): ProjectMentionNameMatch | null {
  const mentionKey = normalizeProjectNameKey(rawName);
  if (!mentionKey) return null;
  if (normalizeProjectNameKey(doc.name) === mentionKey) return "exact";
  for (const alias of doc.aliases) {
    if (normalizeProjectNameKey(alias) === mentionKey) return "alias";
  }
  if (
    projectWorkNameMatchesPolicy(rawName, {
      workLabel: doc.name ?? "",
      aliases: doc.aliases,
    })
  ) {
    return "work";
  }
  return null;
}

function multiValueKeys(raw: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const part of splitProjectMultiValue(raw)) {
    const key = normalizeProjectNameKey(part);
    if (key) keys.add(key);
  }
  return keys;
}

function multiValueOverlaps(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const rightKeys = multiValueKeys(right);
  if (rightKeys.size === 0) return false;
  for (const key of multiValueKeys(left)) {
    if (rightKeys.has(key)) return true;
  }
  return false;
}

export function extractProjectFormalIdentifiers(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(FORMAL_ID_RE.source, FORMAL_ID_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const token = (match[1] ?? "").trim();
    const key = normalizeProjectNameKey(token);
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export function daysBetweenIso(
  left: string | null | undefined,
  right: string | null | undefined,
): number | null {
  if (!left?.trim() || !right?.trim()) return null;
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / 86_400_000;
}

export function projectMentionQueryHasAnchor(
  query: Pick<ProjectMentionQuery, "anchorId">,
): boolean {
  return Boolean(query.anchorId?.trim());
}

export function projectMentionMissingCanonicalAnchor(
  query: Pick<ProjectMentionQuery, "anchorType" | "anchorId">,
): boolean {
  return Boolean(query.anchorType) && !query.anchorId?.trim();
}

/**
 * Hard gate: same anchor type (when both set) and matching canonical id
 * on anchor_id or equipment_ids. NULL never matches NULL.
 */
export function projectMentionAnchorMatches(
  query: Pick<ProjectMentionQuery, "anchorType" | "anchorId">,
  doc: Pick<
    ProjectMentionSearchDocument,
    "anchorType" | "anchorId" | "equipmentIds"
  >,
): boolean {
  const qId = query.anchorId?.trim() || "";
  if (!qId) return false;
  const dId = doc.anchorId?.trim() || "";
  const equipmentIds = doc.equipmentIds ?? [];
  const idMatch = dId === qId || equipmentIds.includes(qId);
  if (!idMatch) return false;

  const qType = query.anchorType ?? null;
  const dType = doc.anchorType ?? null;
  if (!qType || !dType) return true;
  if (qType === dType) return true;
  return (
    (qType === "provisional_equipment" && dType === "equipment") ||
    (qType === "equipment" && dType === "provisional_equipment")
  );
}

export function projectEntityWorkIsCompleted(
  doc: Pick<ProjectMentionSearchDocument, "phase" | "completedAt">,
): boolean {
  if (doc.completedAt?.trim()) return true;
  const phase = (doc.phase ?? "").trim().toLowerCase();
  return COMPLETED_PHASES.has(phase);
}

export function projectMentionExplicitIdMatches(
  identifier: string | null | undefined,
  aliases: readonly string[],
): boolean {
  const key = normalizeProjectNameKey(identifier);
  if (!key || key.length < 2) return false;
  for (const alias of aliases) {
    const aliasKey = normalizeProjectNameKey(alias);
    if (!aliasKey) continue;
    if (aliasKey === key) return true;
    if (aliasKey.includes(key) || key.includes(aliasKey)) return true;
  }
  return false;
}

function collectQueryIdentifiers(query: ProjectMentionQuery): string[] {
  const fromField = query.explicitIdentifier?.trim();
  const extracted = extractProjectFormalIdentifiers(query.rawName);
  if (fromField) return [fromField, ...extracted];
  return extracted;
}

function explicitIdHitsDocument(
  query: ProjectMentionQuery,
  doc: ProjectMentionSearchDocument,
): boolean {
  const aliases = [
    ...(doc.aliases ?? []),
    doc.name ?? "",
  ];
  for (const identifier of collectQueryIdentifiers(query)) {
    if (projectMentionExplicitIdMatches(identifier, aliases)) return true;
  }
  return false;
}

export function classifyProjectMentionLifecycle(
  query: ProjectMentionQuery,
  doc: ProjectMentionSearchDocument,
): ProjectMentionLifecycle {
  if (!projectEntityWorkIsCompleted(doc)) return "open";
  if (explicitIdHitsDocument(query, doc)) return "explicit_id";
  const days = daysBetweenIso(query.mentionDate, doc.completedAt);
  if (
    days != null &&
    days <= PROJECT_TRAILING_INVOICE_DAYS &&
    multiValueOverlaps(query.contractor, doc.contractor)
  ) {
    return "trailing_invoice";
  }
  return "completed_locked";
}

function scoreLexicalCandidate(
  query: ProjectMentionQuery,
  doc: ProjectMentionSearchDocument,
  nameMatch: ProjectMentionNameMatch,
  yearCompatible: boolean,
): number {
  let score = NAME_MATCH_SCORE[nameMatch];
  if (multiValueOverlaps(query.contractor, doc.contractor)) score += 8;
  if (multiValueOverlaps(query.location, doc.location)) score += 8;
  if (
    yearCompatible &&
    parseProjectYearRange(query.yearHint) &&
    parseProjectYearRange(doc.yearHint)
  ) {
    score += 12;
  }
  return score;
}

function lifecyclePassesYearGate(
  candidate: ProjectLexicalCandidate,
): boolean {
  if (candidate.lifecycle === "trailing_invoice") return true;
  if (candidate.lifecycle === "explicit_id") return true;
  return candidate.yearCompatible;
}

/**
 * In-memory lexical shortlist. Contractor/location only rank; they never
 * admit a candidate that failed name/alias/work matching.
 *
 * When the query has a canonical anchor, mismatched assets stay in the
 * shortlist with `anchorCompatible: false` so the decision function can
 * emit `anchor_mismatch` instead of a silent empty list.
 */
export function shortlistProjectMentionCandidates(
  query: ProjectMentionQuery,
  documents: readonly ProjectMentionSearchDocument[],
  limit: number = PROJECT_MENTION_SHORTLIST_LIMIT,
): ProjectLexicalCandidate[] {
  const needle = query.rawName.trim();
  if (!needle || limit <= 0) return [];

  const gated = projectMentionQueryHasAnchor(query);
  const ranked: ProjectLexicalCandidate[] = [];
  for (const doc of documents) {
    const nameMatch = classifyProjectMentionNameMatch(needle, doc);
    if (!nameMatch) continue;
    const yearCompatible = projectMentionYearCompatible(
      query.yearHint,
      doc.yearHint,
    );
    const lifecycle = classifyProjectMentionLifecycle(query, doc);
    ranked.push({
      id: doc.id,
      nameMatch,
      yearCompatible,
      score: scoreLexicalCandidate(query, doc, nameMatch, yearCompatible),
      anchorCompatible: gated ? projectMentionAnchorMatches(query, doc) : true,
      lifecycle,
      isTrailingInvoice: lifecycle === "trailing_invoice",
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });
  return ranked.slice(0, limit);
}

function uniqueId(ids: string[]): string | null {
  if (ids.length !== 1) return null;
  return ids[0] ?? null;
}

function withLifecycleDefaults(
  candidate: ProjectLexicalCandidate,
): ProjectLexicalCandidate {
  return {
    ...candidate,
    anchorCompatible: candidate.anchorCompatible !== false,
    lifecycle: candidate.lifecycle ?? "open",
    isTrailingInvoice:
      candidate.isTrailingInvoice === true ||
      candidate.lifecycle === "trailing_invoice",
  };
}

export function decideProjectMentionResolution(
  signals: ProjectMentionResolveSignals,
): ProjectMentionResolveDecision {
  if (signals.missingAnchor) {
    return {
      status: "unresolved",
      projectId: null,
      reason: "ambiguous_equipment",
    };
  }

  const identityIds = [
    ...new Set(signals.uniqueIdentityMatches.filter(Boolean)),
  ];
  const uniqueIdentity = uniqueId(identityIds);
  if (uniqueIdentity) {
    return {
      status: "confirmed",
      projectId: uniqueIdentity,
      reason: "unique_identity_key",
    };
  }
  if (identityIds.length > 1) {
    return {
      status: "unresolved",
      projectId: null,
      reason: "identity_key_ambiguous",
    };
  }

  const lexical = signals.lexicalCandidates.map(withLifecycleDefaults);
  const anchored = lexical.filter((candidate) => candidate.anchorCompatible);
  if (lexical.length > 0 && anchored.length === 0) {
    return {
      status: "unresolved",
      projectId: null,
      reason: "anchor_mismatch",
    };
  }

  const unlocked = anchored.filter(
    (candidate) => candidate.lifecycle !== "completed_locked",
  );
  if (anchored.length > 0 && unlocked.length === 0) {
    return {
      status: "unresolved",
      projectId: null,
      reason: "completed_locked",
    };
  }

  const yearOk = unlocked.filter(lifecyclePassesYearGate);
  if (yearOk.length === 0) {
    return {
      status: "unresolved",
      projectId: null,
      reason: unlocked.length > 0 || anchored.length > 0
        ? "year_mismatch"
        : "insufficient",
    };
  }

  const exactOrAlias = yearOk.filter(
    (candidate) =>
      candidate.nameMatch === "exact" || candidate.nameMatch === "alias",
  );
  const uniqueExact = uniqueId(exactOrAlias.map((candidate) => candidate.id));
  if (uniqueExact) {
    const hit = exactOrAlias.find((candidate) => candidate.id === uniqueExact);
    const trailing = hit?.isTrailingInvoice === true;
    return {
      status: "confirmed",
      projectId: uniqueExact,
      reason: trailing
        ? "trailing_invoice_attached"
        : "unique_name_or_alias",
    };
  }
  if (exactOrAlias.length > 1) {
    return {
      status: "unresolved",
      projectId: null,
      reason: "name_ambiguous",
    };
  }

  const work = yearOk.filter((candidate) => candidate.nameMatch === "work");
  const uniqueWork = uniqueId(work.map((candidate) => candidate.id));
  if (uniqueWork) {
    const hit = work.find((candidate) => candidate.id === uniqueWork);
    const trailing = hit?.isTrailingInvoice === true;
    return {
      status: "provisional",
      projectId: uniqueWork,
      reason: trailing
        ? "trailing_invoice_attached"
        : "unique_work_name_provisional",
    };
  }
  if (work.length > 1) {
    return {
      status: "unresolved",
      projectId: null,
      reason: "work_name_ambiguous",
    };
  }

  return {
    status: "unresolved",
    projectId: null,
    reason: "insufficient",
  };
}
