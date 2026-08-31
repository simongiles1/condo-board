/**
 * Project-mention candidate retrieval + resolution (no DB).
 *
 * Search document = name + aliases + contractor + year + location.
 * Name matching uses name+aliases only so a contractor-as-name mention
 * cannot attach through the contractor field.
 *
 * The retriever returns at most five lexical hits. Attach is
 * decideProjectMentionResolution's job:
 *   unique identity_key → confirmed
 *   unique exact name or alias, year-compatible → confirmed
 *   unique work-name equivalent, year-compatible → provisional
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

export type ProjectMentionNameMatch = "exact" | "alias" | "work";

export type ProjectMentionSearchDocument = {
  id: string;
  identityKey: string;
  name: string | null;
  aliases: string[];
  contractor: string | null;
  yearHint: string | null;
  location: string | null;
};

export type ProjectMentionQuery = {
  rawName: string;
  contractor: string | null;
  yearHint: string | null;
  location: string | null;
};

export type ProjectLexicalCandidate = {
  id: string;
  nameMatch: ProjectMentionNameMatch;
  yearCompatible: boolean;
  score: number;
};

export type ProjectMentionResolveSignals = {
  uniqueIdentityMatches: string[];
  lexicalCandidates: ProjectLexicalCandidate[];
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

/**
 * In-memory lexical shortlist. Contractor/location only rank; they never
 * admit a candidate that failed name/alias/work matching.
 */
export function shortlistProjectMentionCandidates(
  query: ProjectMentionQuery,
  documents: readonly ProjectMentionSearchDocument[],
  limit: number = PROJECT_MENTION_SHORTLIST_LIMIT,
): ProjectLexicalCandidate[] {
  const needle = query.rawName.trim();
  if (!needle || limit <= 0) return [];

  const ranked: ProjectLexicalCandidate[] = [];
  for (const doc of documents) {
    const nameMatch = classifyProjectMentionNameMatch(needle, doc);
    if (!nameMatch) continue;
    const yearCompatible = projectMentionYearCompatible(
      query.yearHint,
      doc.yearHint,
    );
    ranked.push({
      id: doc.id,
      nameMatch,
      yearCompatible,
      score: scoreLexicalCandidate(query, doc, nameMatch, yearCompatible),
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

export function decideProjectMentionResolution(
  signals: ProjectMentionResolveSignals,
): ProjectMentionResolveDecision {
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

  const lexical = signals.lexicalCandidates;
  const yearOk = lexical.filter((candidate) => candidate.yearCompatible);
  if (yearOk.length === 0) {
    return {
      status: "unresolved",
      projectId: null,
      reason: lexical.length > 0 ? "year_mismatch" : "insufficient",
    };
  }

  const exactOrAlias = yearOk.filter(
    (candidate) =>
      candidate.nameMatch === "exact" || candidate.nameMatch === "alias",
  );
  const uniqueExact = uniqueId(exactOrAlias.map((candidate) => candidate.id));
  if (uniqueExact) {
    return {
      status: "confirmed",
      projectId: uniqueExact,
      reason: "unique_name_or_alias",
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
    return {
      status: "provisional",
      projectId: uniqueWork,
      reason: "unique_work_name_provisional",
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
