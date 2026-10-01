/**
 * Groups accepted package facts that share one verbatim quote.
 * A second bid stays a second group. A fact with no shared quote stays ungrouped.
 */

import {
  MEETINGS_V3_FACT_FIELDS,
  normalizeFactText,
  type MeetingsV3FactCandidate,
  type MeetingsV3FactField,
  type MeetingsV3ItemFacts,
} from "@/lib/meeting-v3/facts";

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
  const pages = new Map(
    input.pages.map((page) => [page.pageNumber, normalizeFactText(page.text)]),
  );
  const unused = new Map<string, MeetingsV3FactCandidate>();
  for (const candidate of input.candidates) {
    const key = candidateKey(candidate.field, candidate.value, candidate.page);
    if (!unused.has(key)) unused.set(key, candidate);
  }

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
    const claimed: string[] = [];
    const seenMember = new Set<string>();
    for (const member of proposed.members) {
      if (!member || typeof member !== "object") continue;
      const record = member as { field?: unknown; value?: unknown };
      if (typeof record.field !== "string" || !FIELD_SET.has(record.field)) continue;
      if (typeof record.value !== "string" || !record.value.trim()) continue;
      const field = record.field as MeetingsV3FactField;
      const valueNorm = normalizeFactText(record.value);
      if (!quoteNorm.includes(valueNorm)) continue;
      const key = candidateKey(field, record.value, proposed.page);
      if (seenMember.has(key) || !unused.has(key)) continue;
      const candidate = unused.get(key);
      if (!candidate) continue;
      seenMember.add(key);
      claimed.push(key);
      members.push({ field, value: candidate.value });
    }
    if (members.length < 2) continue;
    for (const key of claimed) unused.delete(key);
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
  const used = new Set(
    groups.flatMap((group) => group.members.map((member) => candidateKey(member.field, member.value, group.page))),
  );
  const ungrouped = input.candidates.filter(
    (candidate) => !used.has(candidateKey(candidate.field, candidate.value, candidate.page)),
  );
  return { groups, ungrouped };
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
  const record = parsed as { groups?: unknown };
  if (!Array.isArray(record.groups)) return null;
  const proposed = record.groups.filter(
    (group): group is MeetingsV3ProposedFactGroup => group != null && typeof group === "object",
  );
  const pages = proposed.flatMap((group) => {
    if (typeof group.page !== "number" || typeof group.quote !== "string") return [];
    return [{ pageNumber: group.page, text: group.quote }];
  });
  return acceptFactGroups({
    pages,
    candidates: facts.candidates,
    proposed,
  });
}

function candidateKey(field: string, value: string, page: number): string {
  return `${field}\0${normalizeFactText(value)}\0${page}`;
}
