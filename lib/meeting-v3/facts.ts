/**
 * Accepts package facts only when the quote is on the named page.
 * The agenda summary is not a source. A second distinct value stays unresolved.
 */

/** Fields a V3 fact can name. */
export const MEETINGS_V3_FACT_FIELDS = ["amount", "vendor", "recommendation", "date"] as const;

/** One field a package page can state. */
export type MeetingsV3FactField = (typeof MEETINGS_V3_FACT_FIELDS)[number];

/** A figure or name copied from one package page. */
export type MeetingsV3FactCandidate = {
  field: MeetingsV3FactField;
  value: string;
  page: number;
  quote: string;
};

/**
 * Facts kept for one agenda item.
 * `unresolvedFields` lists fields that have more than one distinct value.
 */
export type MeetingsV3ItemFacts = {
  candidates: MeetingsV3FactCandidate[];
  unresolvedFields: MeetingsV3FactField[];
};

/** A model fact before it is checked against the page. */
export type MeetingsV3ProposedFact = {
  field?: unknown;
  value?: unknown;
  page?: unknown;
  quote?: unknown;
};

const FIELD_SET = new Set<string>(MEETINGS_V3_FACT_FIELDS);

/**
 * Collapses whitespace so a quote still matches the page when line breaks differ.
 */
export function normalizeFactText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Keeps proposed facts whose quote is on the named page and whose value is inside that quote.
 * Two different amounts (or two vendors, dates, or recommendations) are left unresolved.
 */
export function acceptQuotedFacts(input: {
  pages: Array<{ pageNumber: number; text: string }>;
  proposed: MeetingsV3ProposedFact[];
}): MeetingsV3ItemFacts {
  const pages = new Map(
    input.pages.map((page) => [page.pageNumber, normalizeFactText(page.text)]),
  );
  const candidates: MeetingsV3FactCandidate[] = [];
  const seen = new Set<string>();

  for (const proposed of input.proposed) {
    if (typeof proposed.field !== "string" || !FIELD_SET.has(proposed.field)) continue;
    if (typeof proposed.value !== "string" || !proposed.value.trim()) continue;
    if (typeof proposed.quote !== "string" || !proposed.quote.trim()) continue;
    if (typeof proposed.page !== "number" || !Number.isInteger(proposed.page)) continue;
    const pageText = pages.get(proposed.page);
    if (!pageText) continue;
    const quote = proposed.quote.replace(/\s+/g, " ").trim();
    const value = proposed.value.replace(/\s+/g, " ").trim();
    const quoteNorm = normalizeFactText(quote);
    const valueNorm = normalizeFactText(value);
    if (!quoteNorm || !valueNorm) continue;
    if (!quoteNorm.includes(valueNorm)) continue;
    if (!pageText.includes(quoteNorm)) continue;
    const field = proposed.field as MeetingsV3FactField;
    const key = `${field}\0${valueNorm}\0${proposed.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ field, value, page: proposed.page, quote });
  }

  candidates.sort((left, right) => left.page - right.page || left.field.localeCompare(right.field));
  const unresolvedFields = MEETINGS_V3_FACT_FIELDS.filter((field) => {
    const values = new Set(
      candidates.filter((candidate) => candidate.field === field).map((candidate) => normalizeFactText(candidate.value)),
    );
    return values.size > 1;
  });
  return { candidates, unresolvedFields };
}

/**
 * Reads the model reply into per-item proposed facts.
 * Throws when the reply is not the expected JSON object.
 */
export function readProposedFacts(
  text: string,
): Array<{ agendaItemId: string; facts: MeetingsV3ProposedFact[] }> {
  const parsed = JSON.parse(text) as { items?: unknown };
  if (!Array.isArray(parsed.items)) {
    throw new Error("Fact resolution response did not include items.");
  }
  return parsed.items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { agendaItemId?: unknown; facts?: unknown };
    if (typeof record.agendaItemId !== "string" || !Array.isArray(record.facts)) return [];
    const facts = record.facts.filter(
      (fact): fact is MeetingsV3ProposedFact => fact != null && typeof fact === "object",
    );
    return [{ agendaItemId: record.agendaItemId, facts }];
  });
}

/**
 * The stored fact object, or null when this item has not been resolved.
 */
export function readStoredItemFacts(value: string | null | undefined): MeetingsV3ItemFacts | null {
  if (!value?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { candidates?: unknown };
  if (!Array.isArray(record.candidates)) return null;
  return acceptQuotedFacts({
    pages: record.candidates.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const row = candidate as MeetingsV3FactCandidate;
      if (typeof row.page !== "number" || typeof row.quote !== "string") return [];
      return [{ pageNumber: row.page, text: row.quote }];
    }),
    proposed: record.candidates.filter(
      (candidate): candidate is MeetingsV3ProposedFact => candidate != null && typeof candidate === "object",
    ),
  });
}
