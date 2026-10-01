/**
 * Groups accepted package facts that share one verbatim quote.
 * A second bid stays a second group. A fact with no shared quote stays ungrouped.
 */

import {
  combinedPageText,
  MEETINGS_V3_FACT_FIELDS,
  normalizeFactText,
  type MeetingsV3FactCandidate,
  type MeetingsV3FactField,
  type MeetingsV3ItemFacts,
} from "@/lib/meeting-v3/facts";
import type { MeetingsV3FactStatement } from "@/lib/meeting-v3/fact-statements";

/** One figure inside a grouped source. */
export type MeetingsV3FactGroupMember = {
  field: MeetingsV3FactField;
  value: string;
};

/**
 * Facts kept together because one quote on a page contains each value.
 * `unresolvedFields` lists fields that have more than one distinct value inside that quote.
 */
export type MeetingsV3FactGroup = {
  page: number;
  quote: string;
  members: MeetingsV3FactGroupMember[];
  unresolvedFields: MeetingsV3FactField[];
};

/**
 * Grouped sources for one agenda item.
 * `ungrouped` lists accepted facts that did not share a quote with another fact.
 */
export type MeetingsV3ItemFactGroups = {
  groups: MeetingsV3FactGroup[];
  ungrouped: MeetingsV3FactCandidate[];
  statements: MeetingsV3FactStatement[];
};

/** A model group before it is checked against the page and the accepted facts. */
export type MeetingsV3ProposedFactGroup = {
  page?: unknown;
  quote?: unknown;
  members?: unknown;
};

const FIELD_SET = new Set<string>(MEETINGS_V3_FACT_FIELDS);

/**
 * Keeps a proposed group only when its quote is on that page and every member is an accepted fact inside the quote.
 * A group needs two members. A fact already placed in an earlier group is not used again.
 */
export function acceptFactGroups(input: {
  pages: Array<{ pageNumber: number; text: string }>;
  candidates: MeetingsV3FactCandidate[];
  proposed: MeetingsV3ProposedFactGroup[];
}): MeetingsV3ItemFactGroups {
  const pages = combinedPageText(input.pages);
  const unused = [...input.candidates];

  const groups: MeetingsV3FactGroup[] = [];
  for (const proposed of input.proposed) {
    if (typeof proposed.page !== "number" || !Number.isInteger(proposed.page)) continue;
    if (typeof proposed.quote !== "string" || !proposed.quote.trim()) continue;
    if (!Array.isArray(proposed.members)) continue;
    const pageText = pages.get(proposed.page);
    if (!pageText) continue;
    const quote = proposed.quote.replace(/\s+/g, " ").trim();
    const quoteNorm = normalizeFactText(quote);
    if (!quoteNorm || !pageText.includes(quoteNorm)) continue;

    const members: MeetingsV3FactGroupMember[] = [];
    const taken: MeetingsV3FactCandidate[] = [];
    const seenMember = new Set<string>();
    for (const member of proposed.members) {
      if (!member || typeof member !== "object") continue;
      const record = member as { field?: unknown; value?: unknown };
      if (typeof record.field !== "string" || !FIELD_SET.has(record.field)) continue;
      if (typeof record.value !== "string" || !record.value.trim()) continue;
      const field = record.field as MeetingsV3FactField;
      const valueNorm = normalizeFactText(record.value);
      if (!quoteNorm.includes(valueNorm)) continue;
      const key = `${field}\0${valueNorm}\0${quoteNorm}`;
      if (seenMember.has(key)) continue;
      const index = unused.findIndex(
        (candidate) =>
          candidate.field === field
          && candidate.page === proposed.page
          && normalizeFactText(candidate.value) === valueNorm
          && quoteNorm.includes(normalizeFactText(candidate.quote)),
      );
      if (index < 0) continue;
      const candidate = unused[index];
      if (!candidate) continue;
      unused.splice(index, 1);
      taken.push(candidate);
      seenMember.add(key);
      members.push({ field, value: candidate.value });
    }
    if (members.length < 2) {
      unused.push(...taken);
      continue;
    }
    members.sort(
      (left, right) =>
        MEETINGS_V3_FACT_FIELDS.indexOf(left.field) - MEETINGS_V3_FACT_FIELDS.indexOf(right.field)
        || left.value.localeCompare(right.value),
    );
    const unresolvedFields = MEETINGS_V3_FACT_FIELDS.filter((field) => {
      const values = new Set(
        members
          .filter((member) => member.field === field)
          .map((member) => normalizeFactText(member.value)),
      );
      return values.size > 1;
    });
    groups.push({ page: proposed.page, quote, members, unresolvedFields });
  }

  groups.sort((left, right) => left.page - right.page || left.quote.localeCompare(right.quote));
  return { groups, ungrouped: unused, statements: [] };
}

/**
 * Reads the model reply into per-item proposed groups.
 * Throws when the reply is not the expected JSON object.
 */
export function readProposedFactGroups(
  text: string,
): Array<{ agendaItemId: string; groups: MeetingsV3ProposedFactGroup[] }> {
  const parsed = JSON.parse(text) as { items?: unknown };
  if (!Array.isArray(parsed.items)) {
    throw new Error("Fact grouping response did not include items.");
  }
  return parsed.items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { agendaItemId?: unknown; groups?: unknown };
    if (typeof record.agendaItemId !== "string" || !Array.isArray(record.groups)) return [];
    const groups = record.groups.filter(
      (group): group is MeetingsV3ProposedFactGroup => group != null && typeof group === "object",
    );
    return [{ agendaItemId: record.agendaItemId, groups }];
  });
}

/**
 * The stored groups, checked again against the accepted facts.
 * Returns null when this item has not been grouped.
 */
export function readStoredItemFactGroups(
  value: string | null | undefined,
  facts: MeetingsV3ItemFacts | null,
): MeetingsV3ItemFactGroups | null {
  if (!value?.trim() || !facts) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { groups?: unknown; statements?: unknown };
  if (!Array.isArray(record.groups) && !Array.isArray(record.statements)) return null;
  const proposed = (Array.isArray(record.groups) ? record.groups : []).filter(
    (group): group is MeetingsV3ProposedFactGroup => group != null && typeof group === "object",
  );
  const pages = proposed.flatMap((group) => {
    if (typeof group.page !== "number" || typeof group.quote !== "string") return [];
    return [{ pageNumber: group.page, text: group.quote }];
  });
  const grouped = acceptFactGroups({
    pages,
    candidates: facts.candidates,
    proposed,
  });
  const statements = readStoredStatements(record.statements, facts.candidates);
  if (statements) {
    const placed = new Set(statements.flatMap((statement) => statement.members));
    return {
      groups: [],
      statements,
      ungrouped: facts.candidates.filter((candidate) => !placed.has(candidate)),
    };
  }
  return grouped;
}

function readStoredStatements(
  value: unknown,
  candidates: MeetingsV3FactCandidate[],
): MeetingsV3FactStatement[] | null {
  if (!Array.isArray(value)) return null;
  const unused = [...candidates];
  const statements: MeetingsV3FactStatement[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { subject?: unknown; revision?: unknown; members?: unknown };
    if (typeof record.subject !== "string" || !record.subject.trim()) continue;
    if (!Array.isArray(record.members)) continue;
    const members: MeetingsV3FactCandidate[] = [];
    for (const member of record.members) {
      if (!member || typeof member !== "object") continue;
      const row = member as MeetingsV3FactCandidate;
      if (typeof row.field !== "string" || typeof row.value !== "string") continue;
      if (typeof row.page !== "number" || typeof row.quote !== "string") continue;
      const index = unused.findIndex(
        (candidate) =>
          candidate.field === row.field
          && candidate.page === row.page
          && normalizeFactText(candidate.value) === normalizeFactText(row.value)
          && normalizeFactText(candidate.quote) === normalizeFactText(row.quote),
      );
      if (index < 0) continue;
      const candidate = unused[index];
      if (!candidate) continue;
      unused.splice(index, 1);
      members.push(candidate);
    }
    if (members.length === 0) continue;
    const revision = typeof record.revision === "string" && record.revision.trim() ? record.revision.trim() : null;
    statements.push({
      subject: record.subject.trim(),
      revision,
      pages: [...new Set(members.map((member) => member.page))].sort((left, right) => left - right),
      uncertain: members.some((member) => member.field === "amount" && !member.service),
      members,
    });
  }
  return statements;
}
