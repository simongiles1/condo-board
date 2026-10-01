/**
 * Accepts package facts only when the quote is on the named page.
 * A second fee or a second bidder stays. A conflict is two claims about the same service or the same award.
 */

import {
  decideOrgMentionResolution,
  type OrgMentionSearchDocument,
} from "@/lib/organizations/mention-resolve-shared";

/** Fields a V3 fact can name. */
export const MEETINGS_V3_FACT_FIELDS = ["amount", "vendor", "recommendation", "date"] as const;

/** One field a package page can state. */
export type MeetingsV3FactField = (typeof MEETINGS_V3_FACT_FIELDS)[number];

/** What the package quote explicitly reports. Not a conclusion of this meeting. */
export const MEETINGS_V3_PACKAGE_ROLES = [
  "proposal",
  "recommendation",
  "reported_prior_approval",
  "historical_event",
] as const;

/** A role the source states in the quote. */
export type MeetingsV3PackageRole = (typeof MEETINGS_V3_PACKAGE_ROLES)[number];

/** How an amount is charged, when the quote says so. */
export const MEETINGS_V3_AMOUNT_BASES = ["fixed", "per_visit"] as const;

/** Fixed fee or rate per visit. */
export type MeetingsV3AmountBasis = (typeof MEETINGS_V3_AMOUNT_BASES)[number];

/** Whether a printed vendor name matched one organization. */
export const MEETINGS_V3_ORG_MATCHES = ["confirmed", "ambiguous", "unmatched"] as const;

/** Result of matching a printed name to the organization registry. */
export type MeetingsV3OrgMatch = (typeof MEETINGS_V3_ORG_MATCHES)[number];

/** A figure or name copied from one package page, plus relationships the page supports. */
export type MeetingsV3FactCandidate = {
  field: MeetingsV3FactField;
  value: string;
  page: number;
  quote: string;
  subject?: string;
  service?: string;
  basis?: MeetingsV3AmountBasis;
  role?: MeetingsV3PackageRole;
  qualifications?: string;
  /** Verbatim heading that names the project, when it is not inside the value quote. */
  headingQuote?: string;
  /** Verbatim row or line that names the service or the bidder. */
  rowQuote?: string;
  /** Verbatim nearby sentence for tax, exclusion, or a per-visit condition. */
  conditionQuote?: string;
  bidder?: string;
  option?: string;
  /** Set when a sibling topic's title matches this quote more strongly than this item. */
  topicMismatch?: boolean;
  organizationId?: string;
  organizationMatch?: MeetingsV3OrgMatch;
};

/** A review item a later draft should not treat as settled. */
export type MeetingsV3FactReview = {
  code:
    | "ambiguous_organization"
    | "fee_needs_verification"
    | "conflicting_prices"
    | "conflicting_award"
    | "topic_ownership";
  message: string;
};

/**
 * Facts kept for one agenda item.
 * `unresolvedFields` lists fields with a real conflict, not every repeated kind of value.
 * `reviewIssues` are the specific reasons a topic is not ready to draft.
 */
export type MeetingsV3ItemFacts = {
  candidates: MeetingsV3FactCandidate[];
  unresolvedFields: MeetingsV3FactField[];
  reviewIssues: MeetingsV3FactReview[];
};

/** A model fact before it is checked against the page. */
export type MeetingsV3ProposedFact = {
  field?: unknown;
  value?: unknown;
  page?: unknown;
  quote?: unknown;
  subject?: unknown;
  service?: unknown;
  basis?: unknown;
  role?: unknown;
  qualifications?: unknown;
  headingQuote?: unknown;
  rowQuote?: unknown;
  conditionQuote?: unknown;
  bidder?: unknown;
  option?: unknown;
  topicMismatch?: unknown;
  omit?: unknown;
  organizationId?: unknown;
  organizationMatch?: unknown;
};

const FIELD_SET = new Set<string>(MEETINGS_V3_FACT_FIELDS);
const ROLE_SET = new Set<string>(MEETINGS_V3_PACKAGE_ROLES);
const BASIS_SET = new Set<string>(MEETINGS_V3_AMOUNT_BASES);
const ORG_MATCH_SET = new Set<string>(MEETINGS_V3_ORG_MATCHES);

/** Characters of one page sent in a single fact-resolution call. Later slices cover the rest of the page. */
export const FACT_RESOLUTION_PAGE_CHAR_BUDGET = 2500;

/**
 * Collapses whitespace so a quote still matches the page when line breaks differ.
 */
export function normalizeFactText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * One text blob per page number.
 * Several quotes stored for the same page are joined so a later read can still find each one.
 */
export function combinedPageText(
  pages: Array<{ pageNumber: number; text: string }>,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const page of pages) {
    const next = normalizeFactText(page.text);
    if (!next) continue;
    const prior = map.get(page.pageNumber);
    map.set(page.pageNumber, prior ? `${prior} ${next}` : next);
  }
  return map;
}

/**
 * Splits one page so every character is sent, without cutting the model input at the first budget window.
 * A short page stays one piece. An empty string stays empty.
 */
export function chunkFactPageText(text: string, budget = FACT_RESOLUTION_PAGE_CHAR_BUDGET): string[] {
  if (budget < 1) {
    throw new Error("Fact page character budget must be at least 1.");
  }
  if (!text) return [];
  if (text.length <= budget) return [text];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + budget, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf(" ", end);
      if (breakAt > offset + Math.floor(budget / 2)) end = breakAt;
    }
    const slice = text.slice(offset, end);
    if (slice) chunks.push(slice);
    offset = end;
    while (text[offset] === " ") offset += 1;
  }
  return chunks;
}

/**
 * Expands each page to the slices a fact-resolution call can hold.
 * The page number stays on every slice so a quote is still checked against the full page.
 */
export function expandFactPagesForPrompt(
  pages: readonly { pageNumber: number; text: string }[],
  budget = FACT_RESOLUTION_PAGE_CHAR_BUDGET,
): Array<{ pageNumber: number; text: string }> {
  return pages.flatMap((page) =>
    chunkFactPageText(page.text, budget).map((text) => ({ pageNumber: page.pageNumber, text })),
  );
}

/**
 * Keeps proposed facts whose quote is on the named page and whose value is inside that quote.
 * Two equal amounts on one page both stay when their quotes differ.
 * A heading, a row, or a condition may supply subject, service, bidder, or qualifications when that span is on the same page.
 * A quote that names a sibling topic more strongly than this item is kept and flagged.
 */
export function acceptQuotedFacts(input: {
  pages: Array<{ pageNumber: number; text: string }>;
  proposed: MeetingsV3ProposedFact[];
  title?: string;
  siblingTitles?: readonly string[];
}): MeetingsV3ItemFacts {
  const pages = combinedPageText(input.pages);
  const candidates: MeetingsV3FactCandidate[] = [];
  const seen = new Set<string>();

  for (const proposed of input.proposed) {
    if (typeof proposed.field !== "string" || !FIELD_SET.has(proposed.field)) continue;
    if (typeof proposed.value !== "string" || !proposed.value.trim()) continue;
    if (typeof proposed.quote !== "string" || !proposed.quote.trim()) continue;
    if (typeof proposed.page !== "number" || !Number.isInteger(proposed.page)) continue;
    if (proposed.omit === true) continue;
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
    const key = `${field}\0${valueNorm}\0${proposed.page}\0${quoteNorm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pageOriginal = input.pages.find((page) => page.pageNumber === proposed.page)?.text ?? "";
    const headingQuote = citedSpan(proposed.headingQuote, pageText);
    const rowQuote = citedSpan(proposed.rowQuote, pageText);
    const conditionQuote = citedSpan(proposed.conditionQuote, pageText);
    const supportNorm = [quoteNorm, headingQuote, rowQuote, conditionQuote]
      .filter((span): span is string => Boolean(span))
      .map((span) => normalizeFactText(span))
      .join(" ");
    const candidate: MeetingsV3FactCandidate = { field, value, page: proposed.page, quote };
    if (headingQuote) candidate.headingQuote = headingQuote;
    if (rowQuote) candidate.rowQuote = rowQuote;
    if (conditionQuote) candidate.conditionQuote = conditionQuote;
    const subject = quotedPhrase(proposed.subject, supportNorm);
    const service = quotedPhrase(proposed.service, supportNorm);
    const qualifications = quotedPhrase(proposed.qualifications, supportNorm);
    const bidder = quotedPhrase(proposed.bidder, supportNorm);
    const option = quotedPhrase(proposed.option, supportNorm);
    if (subject) candidate.subject = subject;
    if (service) candidate.service = service;
    if (qualifications) candidate.qualifications = qualifications;
    if (bidder) candidate.bidder = bidder;
    if (option) candidate.option = option;
    const basisNorm = [quoteNorm, conditionQuote ? normalizeFactText(conditionQuote) : ""].join(" ");
    if (typeof proposed.basis === "string" && BASIS_SET.has(proposed.basis) && basisSupported(proposed.basis, basisNorm)) {
      candidate.basis = proposed.basis as MeetingsV3AmountBasis;
    }
    if (typeof proposed.role === "string" && ROLE_SET.has(proposed.role) && roleSupported(proposed.role, quoteNorm)) {
      candidate.role = proposed.role as MeetingsV3PackageRole;
    }
    enrichFactContext(candidate, pageOriginal, input.title, input.siblingTitles ?? []);
    if (proposed.topicMismatch === true) candidate.topicMismatch = true;
    if (typeof proposed.organizationId === "string" && proposed.organizationId.trim()) {
      candidate.organizationId = proposed.organizationId.trim();
    }
    if (typeof proposed.organizationMatch === "string" && ORG_MATCH_SET.has(proposed.organizationMatch)) {
      candidate.organizationMatch = proposed.organizationMatch as MeetingsV3OrgMatch;
    }
    candidates.push(candidate);
  }

  candidates.sort((left, right) => left.page - right.page || left.field.localeCompare(right.field) || left.quote.localeCompare(right.quote));
  return finishFacts(candidates);
}

/**
 * Attaches an organization id when the printed vendor name matches one registry record.
 * An ambiguous name stays unmatched to a single id. Printed text is unchanged.
 */
export function applyOrganizationMatches(
  facts: MeetingsV3ItemFacts,
  documents: readonly OrgMentionSearchDocument[],
): MeetingsV3ItemFacts {
  const candidates = facts.candidates.map((candidate) => {
    if (candidate.field !== "vendor") return candidate;
    const decision = decideOrgMentionResolution({
      rawName: candidate.value,
      headerDomains: [],
      affiliatedOrganizationIds: [],
      documents,
    });
    if (decision.status === "confirmed" && decision.organizationId) {
      return {
        ...candidate,
        organizationId: decision.organizationId,
        organizationMatch: "confirmed" as const,
      };
    }
    if (decision.candidateOrganizationIds.length > 1) {
      return { ...candidate, organizationMatch: "ambiguous" as const };
    }
    return { ...candidate, organizationMatch: "unmatched" as const };
  });
  return finishFacts(candidates);
}

/**
 * Non-blocking notes for the facts screen.
 * A confirmed organization with several printed names, or several labeled fees, is not a conflict.
 */
export function factContextNotes(facts: MeetingsV3ItemFacts): string[] {
  const notes: string[] = [];
  const vendors = facts.candidates.filter((candidate) => candidate.field === "vendor");
  const confirmedIds = new Set(
    vendors
      .filter((candidate) => candidate.organizationMatch === "confirmed" && candidate.organizationId)
      .map((candidate) => candidate.organizationId),
  );
  if (confirmedIds.size === 1 && vendors.length > 1) {
    notes.push("One organization, several printed names.");
  }
  const serviced = facts.candidates.filter((candidate) => candidate.field === "amount" && candidate.service);
  const serviceNames = new Set(serviced.map((candidate) => normalizeFactText(candidate.service ?? "")));
  if (serviceNames.size > 1 && !facts.reviewIssues.some((issue) => issue.code === "conflicting_prices")) {
    notes.push(`${serviceNames.size} services named.`);
  }
  const alternatives = new Map<string, Set<string>>();
  for (const candidate of serviced) {
    if (!candidate.bidder) continue;
    const key = `${normalizeFactText(candidate.subject ?? "")}\0${normalizeFactText(candidate.service ?? "")}`;
    const bidders = alternatives.get(key) ?? new Set<string>();
    bidders.add(normalizeFactText(candidate.bidder));
    alternatives.set(key, bidders);
  }
  for (const bidders of alternatives.values()) {
    if (bidders.size > 1) notes.push(`${bidders.size} alternative prices.`);
  }
  return notes;
}

/** Pages included in one fact-resolution call. */
export const FACT_RESOLUTION_PAGE_BATCH = 4;

/**
 * Output budget for one fact-resolution call.
 * The client default of 4096 cuts off a topic that quotes many amounts and vendors.
 */
export const FACT_RESOLUTION_MAX_OUTPUT_TOKENS = 12288;

/**
 * Ceiling for one fact-resolution HTTP call.
 * A fee table can spend the output budget, and the 120s default aborts that reply.
 */
export const FACT_RESOLUTION_REQUEST_TIMEOUT_MS = 300_000;

/**
 * Recovery is one extra call. More open issues than this are left on the item
 * rather than asking the model to rewrite an entire table in one reply.
 */
export const FACT_RECOVERY_MAX_ISSUES = 12;

/**
 * Whether a failed fact call should be retried on smaller page slices.
 * Truncation and the DeepSeek abort both mean the batch was too large.
 */
export function factRequestShouldSplit(error: unknown, pageCount: number): boolean {
  if (pageCount < 2 || !(error instanceof Error)) return false;
  return error.message.includes("finish_reason=length") || /aborted due to timeout/i.test(error.message);
}

/** One topic's place in a fact-resolution run, including the page batch inside that topic. */
export type FactResolutionProgress = {
  itemIndex: number;
  itemCount: number;
  batchIndex: number;
  batchCount: number;
  label: string;
};

/**
 * Progress line stored on the meeting while Resolve facts is running.
 * The facts screen reads it back into a bar.
 */
export function formatFactResolutionProgress(progress: FactResolutionProgress): string {
  return `Resolving facts · ${progress.itemIndex}/${progress.itemCount} · batch ${progress.batchIndex}/${progress.batchCount} · ${progress.label}`;
}

/**
 * Reads a progress line written by formatFactResolutionProgress.
 * Returns null when the step is some other message.
 */
export function readFactResolutionProgress(step: string | null | undefined): FactResolutionProgress | null {
  const match = step?.match(/^Resolving facts · (\d+)\/(\d+) · batch (\d+)\/(\d+) · (.+)$/);
  if (!match) return null;
  const itemIndex = Number(match[1]);
  const itemCount = Number(match[2]);
  const batchIndex = Number(match[3]);
  const batchCount = Number(match[4]);
  if (itemCount < 1 || batchCount < 1 || itemIndex < 1 || batchIndex < 1) return null;
  return { itemIndex, itemCount, batchIndex, batchCount, label: match[5] ?? "" };
}

/**
 * How far through the run this progress line is, from 0 to 1.
 * The current batch counts as started, not finished.
 */
export function factResolutionProgressFraction(progress: FactResolutionProgress): number {
  const batch = Math.min(progress.batchIndex - 1, progress.batchCount) / progress.batchCount;
  return Math.min(1, Math.max(0, (progress.itemIndex - 1 + batch) / progress.itemCount));
}

/**
 * A single page slice should be cut in half and tried again.
 * A short slice is not divided, so a timeout there can be skipped.
 */
export function factSliceShouldDivide(error: unknown, textLength: number): boolean {
  if (textLength < 800 || !(error instanceof Error)) return false;
  return error.message.includes("finish_reason=length") || /aborted due to timeout/i.test(error.message);
}

/**
 * Splits one topic's pages so a single reply can list every quote.
 * An empty list stays empty.
 */
export function chunkFactPages<T>(pages: readonly T[], size = FACT_RESOLUTION_PAGE_BATCH): T[][] {
  if (size < 1) {
    throw new Error("Fact page batch size must be at least 1.");
  }
  const chunks: T[][] = [];
  for (let offset = 0; offset < pages.length; offset += size) {
    chunks.push(pages.slice(offset, offset + size));
  }
  return chunks;
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
 * Quotes from the same page are checked together so a second quote is not dropped.
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
      return [{ pageNumber: row.page, text: [row.quote, row.headingQuote, row.rowQuote, row.conditionQuote].filter((part) => typeof part === "string").join(" ") }];
    }),
    proposed: record.candidates.filter(
      (candidate): candidate is MeetingsV3ProposedFact => candidate != null && typeof candidate === "object",
    ),
  });
}

function finishFacts(candidates: MeetingsV3FactCandidate[]): MeetingsV3ItemFacts {
  const reviewIssues = reviewFacts(candidates);
  const unresolvedFields = MEETINGS_V3_FACT_FIELDS.filter((field) =>
    reviewIssues.some((issue) =>
      (field === "amount" && issue.code === "conflicting_prices")
      || (field === "vendor" && issue.code === "conflicting_award"),
    ),
  );
  return { candidates, unresolvedFields, reviewIssues };
}

function reviewFacts(candidates: MeetingsV3FactCandidate[]): MeetingsV3FactReview[] {
  const issues: MeetingsV3FactReview[] = [];
  for (const candidate of candidates) {
    if (candidate.field === "vendor" && candidate.organizationMatch === "ambiguous") {
      issues.push({
        code: "ambiguous_organization",
        message: `Organization match is ambiguous for "${candidate.value}".`,
      });
    }
    if (candidate.field === "amount" && amountNeedsContext(candidate)) {
      issues.push({
        code: "fee_needs_verification",
        message: `Fee description needs verification for ${candidate.value}.`,
      });
    }
    if (candidate.topicMismatch) {
      issues.push({
        code: "topic_ownership",
        message: `Quote may belong to another topic: ${candidate.value}.`,
      });
    }
  }

  const prices = new Map<string, { service: string; values: Set<string> }>();
  for (const candidate of candidates) {
    if (candidate.field !== "amount" || !candidate.subject || !candidate.service) continue;
    const key = [
      normalizeFactText(candidate.subject),
      normalizeFactText(candidate.service),
      candidate.basis ?? "",
      normalizeFactText(candidate.bidder ?? ""),
      normalizeFactText(candidate.option ?? ""),
    ].join("\0");
    const row = prices.get(key) ?? { service: candidate.service, values: new Set<string>() };
    row.values.add(normalizeFactText(candidate.value));
    prices.set(key, row);
  }
  for (const row of prices.values()) {
    if (row.values.size > 1) {
      issues.push({
        code: "conflicting_prices",
        message: `Conflicting amounts for ${row.service}.`,
      });
    }
  }

  const awards = new Map<string, MeetingsV3FactCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.field !== "vendor" || candidate.role !== "reported_prior_approval" || !candidate.subject) continue;
    const key = normalizeFactText(candidate.subject);
    const rows = awards.get(key) ?? [];
    rows.push(candidate);
    awards.set(key, rows);
  }
  for (const rows of awards.values()) {
    const ids = new Set(rows.map((row) => row.organizationId).filter((id): id is string => Boolean(id)));
    const names = new Set(rows.map((row) => normalizeFactText(row.value)));
    const conflict = ids.size > 1 || (ids.size === 0 && names.size > 1);
    if (conflict) {
      issues.push({
        code: "conflicting_award",
        message: `Conflicting claims about which company was awarded ${rows[0]?.subject}.`,
      });
    }
  }
  return issues;
}

function quotedPhrase(value: unknown, quoteNorm: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const phrase = value.replace(/\s+/g, " ").trim();
  if (!quoteNorm.includes(normalizeFactText(phrase))) return undefined;
  return phrase;
}

function basisSupported(basis: string, quoteNorm: string): boolean {
  if (basis === "per_visit") return /per visit|\/\s*visit/.test(quoteNorm);
  if (basis === "fixed") return /\bfixed\b/.test(quoteNorm);
  return false;
}

function roleSupported(role: string, quoteNorm: string): boolean {
  if (role === "proposal") return /\bpropos/.test(quoteNorm) || /\bbid\b/.test(quoteNorm);
  if (role === "recommendation") return /\brecommend/.test(quoteNorm);
  if (role === "reported_prior_approval") return /\bapprov/.test(quoteNorm);
  if (role === "historical_event") return /\bincident\b/.test(quoteNorm) || /\boccurred\b/.test(quoteNorm);
  return false;
}

function dollarCount(quote: string): number {
  return quote.match(/\$\s?\d/g)?.length ?? 0;
}

const GENERIC_SERVICE = /^(fee|fees|cost|costs|amount|price|total|subtotal)$/i;

function amountNeedsContext(candidate: MeetingsV3FactCandidate): boolean {
  if (candidate.field !== "amount") return false;
  const isolating = candidate.rowQuote && dollarCount(candidate.rowQuote) > 0 ? candidate.rowQuote : candidate.quote;
  if (!candidate.service || GENERIC_SERVICE.test(candidate.service)) return true;
  return dollarCount(isolating) > 1;
}

function citedSpan(value: unknown, pageNorm: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const phrase = value.replace(/\s+/g, " ").trim();
  if (!pageNorm.includes(normalizeFactText(phrase))) return undefined;
  return phrase;
}

/**
 * Fills a missing project or service from the heading or the amount line on the same page.
 * A heading that fits a sibling topic better is not copied onto this item.
 */
function enrichFactContext(
  candidate: MeetingsV3FactCandidate,
  pageText: string,
  title: string | undefined,
  siblingTitles: readonly string[],
): void {
  const lines = pageText.split(/\n/);
  const quoteKey = normalizeFactText(candidate.quote).slice(0, 48);
  const lineIndex = lines.findIndex((line) => normalizeFactText(line).includes(quoteKey));
  if (!candidate.subject) {
    const heading = lineIndex >= 0 ? precedingHeading(lines, lineIndex) : candidate.headingQuote;
    if (heading && !siblingOwns(heading, title, siblingTitles)) candidate.subject = heading;
  }
  if (candidate.field === "amount" && !candidate.service) {
    const fromLine = serviceFromAmountLine(candidate.quote, candidate.value);
    if (fromLine) candidate.service = fromLine;
  }
  if (!candidate.qualifications && lineIndex >= 0) {
    const condition = nearbyCondition(lines, lineIndex);
    if (condition) {
      candidate.conditionQuote = condition;
      candidate.qualifications = condition;
      if (!candidate.basis && /per visit|\/\s*visit/i.test(condition)) candidate.basis = "per_visit";
    }
  }
  const ownershipText = [candidate.quote, candidate.headingQuote, candidate.subject].filter(Boolean).join(" ");
  if (siblingOwns(ownershipText, title, siblingTitles)) candidate.topicMismatch = true;
}

function precedingHeading(lines: string[], index: number): string | undefined {
  // CONCERN: a short line above the amount is treated as the project heading. A caption or a column label can be copied as the subject.
  for (let cursor = index - 1; cursor >= 0 && index - cursor < 30; cursor -= 1) {
    const line = lines[cursor].replace(/\s+/g, " ").trim();
    if (!line || line.includes("$") || line.length > 90) continue;
    if ((line.match(/\|/g) ?? []).length >= 2) continue;
    return line;
  }
  return undefined;
}

function serviceFromAmountLine(quote: string, value: string): string | undefined {
  const index = quote.indexOf(value);
  if (index <= 0) return undefined;
  const label = quote.slice(0, index).replace(/[|:—–:.\-]+\s*$/g, "").replace(/^[A-Z0-9][.)]\s+/, "").trim();
  if (!label || label.includes("$") || label.length > 80 || label.length < 3) return undefined;
  if (/\b(propos|is|are|from|for|of|bid)\b/i.test(label)) return undefined;
  if (GENERIC_SERVICE.test(label)) return undefined;
  return label;
}

function nearbyCondition(lines: string[], index: number): string | undefined {
  for (let cursor = index + 1; cursor < Math.min(lines.length, index + 4); cursor += 1) {
    const line = lines[cursor].replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (line.includes("$")) return undefined;
    if (/\b(exclud|tax|hst|gst|per visit|\/\s*visit)\b/i.test(line) && line.length < 180) return line;
  }
  return undefined;
}

function siblingOwns(text: string, title: string | undefined, siblingTitles: readonly string[]): boolean {
  const own = titleTokenHits(text, title ?? "");
  return siblingTitles.some((sibling) => {
    const hits = titleTokenHits(text, sibling);
    const tokenCount = titleTokens(sibling).length;
    const strong = tokenCount <= 1 ? hits >= 1 : hits >= Math.min(2, tokenCount);
    return strong && hits > own;
  });
}

function titleTokenHits(text: string, title: string): number {
  const haystack = normalizeFactText(text);
  return titleTokens(title).filter((token) => haystack.includes(token)).length;
}

function titleTokens(title: string): string[] {
  const stop = new Set(["the", "and", "for", "with", "from", "this", "that", "item", "report"]);
  return normalizeFactText(title).split(" ").filter((word) => word.length > 3 && !stop.has(word));
}

/**
 * One line per item for the facts screen.
 * Fee warnings collapse to a count and the pages they sit on.
 */
export function summarizeItemFactReviews(item: {
  itemNumber: string;
  title: string;
  facts: MeetingsV3ItemFacts | null;
}): string[] {
  const issues = item.facts?.reviewIssues ?? [];
  if (issues.length === 0) return [];
  const lines: string[] = [];
  const fees = issues.filter((issue) => issue.code === "fee_needs_verification");
  if (fees.length > 0) {
    const pages = [...new Set(
      (item.facts?.candidates ?? [])
        .filter((candidate) => candidate.field === "amount" && amountNeedsContext(candidate))
        .map((candidate) => candidate.page),
    )].sort((left, right) => left - right);
    const pageLabel = pages.length > 0 ? ` Pages ${pages.join(", ")}.` : "";
    lines.push(`${item.itemNumber} ${item.title}: ${fees.length} amounts need context.${pageLabel}`);
  }
  for (const issue of issues) {
    if (issue.code === "fee_needs_verification") continue;
    lines.push(`${item.itemNumber} ${item.title}: ${issue.message}`);
  }
  return lines;
}

/**
 * Replaces a stored proposal when recovery returns the same field, value, and page.
 * `omit` drops that proposal. A new value is appended.
 */
export function mergeProposedFacts(
  base: readonly MeetingsV3ProposedFact[],
  recovered: readonly MeetingsV3ProposedFact[],
): MeetingsV3ProposedFact[] {
  const next = [...base];
  for (const fact of recovered) {
    const index = next.findIndex((row) => sameProposedIdentity(row, fact));
    if (fact.omit === true) {
      if (index >= 0) next.splice(index, 1);
      continue;
    }
    if (index >= 0) next[index] = { ...next[index], ...fact };
    else next.push(fact);
  }
  return next;
}

function sameProposedIdentity(left: MeetingsV3ProposedFact, right: MeetingsV3ProposedFact): boolean {
  if (left.field !== right.field || left.page !== right.page) return false;
  if (typeof left.value !== "string" || typeof right.value !== "string") return false;
  return normalizeFactText(left.value) === normalizeFactText(right.value);
}
