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
  /** Verbatim table header row whose column names the bidder for this amount. */
  columnQuote?: string;
  /**
   * Page that prints `columnQuote` when the amount is on the following page.
   * Absent when the header and the amount are on the same page.
   */
  columnPage?: number;
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
    | "missing_bidder"
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
  columnQuote?: unknown;
  /** Page that prints `columnQuote` when that header is not on `page`. */
  columnPage?: unknown;
  bidder?: unknown;
  option?: unknown;
  topicMismatch?: unknown;
  omit?: unknown;
  /** Replacement citation. `quote` remains the stored quote that identifies the fact. */
  revisedQuote?: unknown;
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
 * Two equal amounts on one page both stay when their quotes or their bidders differ.
 * A heading, a row, or a condition may supply subject, service, bidder, or qualifications when that span is on the same page.
 * A supplier header carries onto the next page only when that table continues, and the header stays cited on the page that prints it.
 * A quote that names a sibling topic more strongly than this item is kept and flagged.
 */
export function acceptQuotedFacts(input: {
  pages: Array<{ pageNumber: number; text: string }>;
  proposed: MeetingsV3ProposedFact[];
  title?: string;
  siblingTitles?: readonly string[];
}): MeetingsV3ItemFacts {
  const pages = combinedPageText(input.pages);
  const originals = originalPageText(input.pages);
  const carriedHeaders = carriedSupplierHeaders(originals);
  const candidates: MeetingsV3FactCandidate[] = [];
  const seen = new Set<string>();
  const claimedCells = new Set<string>();

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
    const pageOriginal = originals.get(proposed.page) ?? "";
    const columnPage = statedColumnPage(proposed, originals, proposed.page);
    const headingQuote = citedSpan(proposed.headingQuote, pageText);
    const rowQuote = citedSpan(proposed.rowQuote, pageText);
    const conditionQuote = citedSpan(proposed.conditionQuote, pageText);
    const columnQuote = citedSpan(proposed.columnQuote, originals.get(columnPage) ?? "");
    const supportNorm = [quoteNorm, headingQuote, rowQuote, conditionQuote, columnQuote]
      .filter((span): span is string => Boolean(span))
      .map((span) => normalizeFactText(span))
      .join(" ");
    const candidate: MeetingsV3FactCandidate = { field, value, page: proposed.page, quote };
    if (headingQuote) candidate.headingQuote = headingQuote;
    if (rowQuote) candidate.rowQuote = rowQuote;
    if (conditionQuote) candidate.conditionQuote = conditionQuote;
    if (columnQuote) {
      candidate.columnQuote = columnQuote;
      if (columnPage !== proposed.page) candidate.columnPage = columnPage;
    }
    const subject = quotedPhrase(proposed.subject, supportNorm);
    const service = quotedPhrase(proposed.service, supportNorm);
    const qualifications = quotedPhrase(proposed.qualifications, supportNorm);
    const bidder = quotedPhrase(proposed.bidder, supportNorm);
    const option = quotedPhrase(proposed.option, supportNorm);
    if (subject) candidate.subject = subject;
    if (service) candidate.service = service;
    if (qualifications) candidate.qualifications = qualifications;
    if (bidder && isSupplierCell(bidder)) candidate.bidder = bidder;
    if (option) candidate.option = option;
    const basisNorm = [quoteNorm, conditionQuote ? normalizeFactText(conditionQuote) : ""].join(" ");
    if (typeof proposed.basis === "string" && BASIS_SET.has(proposed.basis) && basisSupported(proposed.basis, basisNorm)) {
      candidate.basis = proposed.basis as MeetingsV3AmountBasis;
    }
    if (typeof proposed.role === "string" && ROLE_SET.has(proposed.role) && roleSupported(proposed.role, quoteNorm)) {
      candidate.role = proposed.role as MeetingsV3PackageRole;
    }
    enrichFactContext(
      candidate,
      pageOriginal,
      input.title,
      input.siblingTitles ?? [],
      claimedCells,
      carriedHeaders.get(proposed.page),
    );
    if (candidate.bidder && !isSupplierCell(candidate.bidder)) delete candidate.bidder;
    if (proposed.topicMismatch === true) candidate.topicMismatch = true;
    if (typeof proposed.organizationId === "string" && proposed.organizationId.trim()) {
      candidate.organizationId = proposed.organizationId.trim();
    }
    if (typeof proposed.organizationMatch === "string" && ORG_MATCH_SET.has(proposed.organizationMatch)) {
      candidate.organizationMatch = proposed.organizationMatch as MeetingsV3OrgMatch;
    }
    const identity = [
      field,
      valueNorm,
      String(proposed.page),
      quoteNorm,
      factLabelKey(candidate.bidder ?? ""),
      factLabelKey(candidate.option ?? ""),
    ].join("\0");
    if (seen.has(identity)) continue;
    seen.add(identity);
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
 * Tax, totals, and investment holdings are not counted as services or competing bids.
 * The same comparison line is returned once. The amounts stay on the item.
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
  const feeNames = new Set(
    serviced
      .filter((candidate) => amountKind(candidate) === "fee")
      .map((candidate) => normalizeFactText(candidate.service ?? "")),
  );
  if (feeNames.size > 1 && !facts.reviewIssues.some((issue) => issue.code === "conflicting_prices")) {
    notes.push(`${feeNames.size} services named.`);
  }
  const holdings = new Set(
    serviced
      .filter((candidate) => amountKind(candidate) === "investment")
      .map((candidate) => normalizeFactText(candidate.bidder || candidate.service || candidate.value)),
  );
  if (holdings.size > 1) notes.push(`${holdings.size} investment holdings.`);
  const alternatives = new Map<string, { service: string; bidders: Map<string, string> }>();
  for (const candidate of serviced) {
    if (amountKind(candidate) !== "fee" || !candidate.bidder) continue;
    const key = `${factLabelKey(candidate.subject ?? "")}\0${factLabelKey(candidate.service ?? "")}`;
    const row = alternatives.get(key) ?? { service: candidate.service ?? "", bidders: new Map<string, string>() };
    const bidderId = factLabelKey(candidate.bidder);
    if (!row.bidders.has(bidderId)) row.bidders.set(bidderId, candidate.bidder);
    alternatives.set(key, row);
  }
  for (const row of alternatives.values()) {
    if (row.bidders.size > 1) {
      const names = [...row.bidders.values()].join(", ");
      notes.push(`${tidyFactLabel(row.service)}: ${row.bidders.size} alternative prices (${names}).`);
    }
  }
  return [...new Set(notes)];
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
 * How long a fact call may sit after DeepSeek accepts it with no text.
 * The API sends comment keep-alives while a completion is queued, and the
 * 300s ceiling would hold the topic on that silence.
 */
export const FACT_RESOLUTION_STALL_MS = 45_000;

/**
 * How many unresolved facts one recovery call may repair.
 * A larger topic is split into calls of this size. It is not skipped.
 */
export const FACT_RECOVERY_MAX_ISSUES = 12;

/**
 * Whether a failed fact call should be retried on smaller page slices.
 * Truncation and the DeepSeek abort both mean the batch was too large.
 */
export function factRequestShouldSplit(error: unknown, pageCount: number): boolean {
  if (pageCount < 2 || !(error instanceof Error)) return false;
  if (error.message.includes("sent no text")) return false;
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
  if (error.message.includes("sent no text")) return false;
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
 * A supplier header cited on an earlier page is checked on that page.
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
  const buckets = new Map<number, string[]>();
  const add = (page: number, text: string | undefined) => {
    if (typeof text !== "string" || !text.trim()) return;
    const parts = buckets.get(page) ?? [];
    parts.push(text);
    buckets.set(page, parts);
  };
  for (const candidate of record.candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as MeetingsV3FactCandidate;
    if (typeof row.page !== "number" || typeof row.quote !== "string") continue;
    add(row.page, row.quote);
    add(row.page, row.headingQuote);
    add(row.page, row.rowQuote);
    add(row.page, row.conditionQuote);
    const columnPage = typeof row.columnPage === "number" ? row.columnPage : row.page;
    add(columnPage, row.columnQuote);
  }
  return acceptQuotedFacts({
    pages: [...buckets].map(([pageNumber, parts]) => ({ pageNumber, text: parts.join("\n") })),
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

  const prices = new Map<string, { service: string; bidder: string; values: Set<string> }>();
  for (const candidate of candidates) {
    if (candidate.field !== "amount" || !candidate.subject || !candidate.service) continue;
    const key = priceGroupKey(candidate);
    const row = prices.get(key) ?? { service: candidate.service, bidder: candidate.bidder ?? "", values: new Set<string>() };
    row.values.add(normalizeFactText(candidate.value));
    prices.set(key, row);
  }
  for (const row of prices.values()) {
    if (row.values.size <= 1) continue;
    const service = tidyFactLabel(row.service);
    if (!factLabelKey(row.bidder)) {
      issues.push({
        code: "missing_bidder",
        message: `Bidder is missing for ${service}.`,
      });
      continue;
    }
    issues.push({
      code: "conflicting_prices",
      message: `Conflicting amounts for ${service}.`,
    });
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

function amountKind(candidate: MeetingsV3FactCandidate): "fee" | "tax" | "total" | "balance" | "investment" {
  // Purpose comes from what the amount pays for. "Plus HST" on a fee is a condition, and the project title is not the holding.
  const purpose = normalizeFactText([candidate.service, candidate.option].filter(Boolean).join(" "));
  if (/\b(hst|gst|vat|harmonized|sales tax)\b/.test(purpose) || /\btax\b/.test(purpose)) return "tax";
  if (/\b(gic|gics|term deposit|treasury)\b/.test(purpose) || /^(reserve|reserves|reserve fund)$/.test(purpose)) return "investment";
  if (/\b(subtotal|grand total|amount due|invoice total|balance due)\b/.test(purpose) || /\btotal\b/.test(purpose)) return "total";
  if (/\bbalance\b/.test(purpose)) return "balance";
  return "fee";
}

/** Groups the same commercial line when the extracted label only differs by trailing punctuation. */
function stripFactEmphasis(value: string): string {
  return value.replace(/[*_`]/g, "");
}

function factLabelKey(value: string): string {
  return normalizeFactText(stripFactEmphasis(value)).replace(/[\s.|:;…]+$/g, "").trim();
}

function tidyFactLabel(value: string): string {
  return stripFactEmphasis(value).replace(/\s+/g, " ").trim().replace(/[\s.|:;…]+$/g, "");
}

function priceGroupKey(candidate: MeetingsV3FactCandidate): string {
  return [
    factLabelKey(candidate.subject ?? ""),
    factLabelKey(candidate.service ?? ""),
    candidate.basis ?? "",
    factLabelKey(candidate.bidder ?? ""),
    factLabelKey(candidate.option ?? ""),
  ].join("\0");
}

function dollarCount(quote: string): number {
  return quote.match(/\$\s?\d/g)?.length ?? 0;
}

const GENERIC_SERVICE = /^(fee|fees|cost|costs|amount|price|total|subtotal)$/i;
const AMOUNT_SPAN = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*[A-Za-z]+)?/g;

function amountSpans(text: string): Array<{ value: string; label: string }> {
  const spans: Array<{ value: string; label: string }> = [];
  const pattern = new RegExp(AMOUNT_SPAN.source, "g");
  let previousEnd = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    spans.push({ value: match[0], label: text.slice(previousEnd, index) });
    previousEnd = index + match[0].length;
  }
  return spans;
}

function amountKey(value: string): string {
  return value.replace(/[^\d.]/g, "");
}

function labelIsBlank(label: string): boolean {
  return normalizeFactText(label.replace(/[|:—–\-.,]+/g, " ")).length < 2;
}

function labelHasMarker(label: string, marker: string): boolean {
  const key = normalizeFactText(marker);
  if (key.length < 2) return false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(normalizeFactText(label));
}

function amountNeedsContext(candidate: MeetingsV3FactCandidate): boolean {
  if (candidate.field !== "amount") return false;
  const isolating = candidate.rowQuote && dollarCount(candidate.rowQuote) > 0 ? candidate.rowQuote : candidate.quote;
  if (!candidate.service || GENERIC_SERVICE.test(candidate.service)) return true;
  const spans = amountSpans(isolating);
  if (spans.length <= 1) return false;
  const valueKey = amountKey(candidate.value);
  const own = spans.filter((span) => amountKey(span.value) === valueKey);
  if (spans.some((span) => labelIsBlank(span.label))) {
    // A column heading stored on the fact names this cell even when the row text between the figures is blank.
    if (own.length === 1 && (candidate.bidder?.trim() || candidate.option?.trim())) return false;
    return true;
  }
  if (own.length !== 1) return true;
  const markers = [candidate.bidder, candidate.option, candidate.service].filter(
    (marker): marker is string => Boolean(marker?.trim()),
  );
  const others = spans.filter((span) => span !== own[0]);
  return !markers.some((marker) =>
    labelHasMarker(own[0]?.label ?? "", marker)
    && others.every((span) => !labelHasMarker(span.label, marker)),
  );
}

function citedSpan(value: unknown, pageText: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const phrase = value.replace(/\s+/g, " ").trim();
  if (!normalizeFactText(pageText).includes(normalizeFactText(phrase))) return undefined;
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
  claimedCells: Set<string>,
  carried?: CarriedSupplierHeader,
): void {
  const lines = pageText.split(/\n/);
  const quoteKey = normalizeFactText(candidate.quote).slice(0, 48);
  const lineIndex = lines.findIndex((line) => normalizeFactText(line).includes(quoteKey));
  if (!candidate.subject) {
    const heading = lineIndex >= 0 ? precedingHeading(lines, lineIndex) : candidate.headingQuote;
    if (heading && !siblingOwns(heading, title, siblingTitles)) {
      candidate.subject = heading;
      // The stored page is rebuilt from these spans. Without the heading, the subject is dropped on read-back.
      if (!candidate.headingQuote) candidate.headingQuote = heading;
    }
  }
  if (candidate.field === "amount" && !candidate.service) {
    const fromLine = serviceFromAmountLine(candidate.quote, candidate.value);
    if (fromLine) candidate.service = fromLine;
  }
  applyTableColumns(candidate, pageText, claimedCells, carried);
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

const GENERIC_SECTION = /^(engineering fees|professional fees|consulting fees|fees|introduction|background|summary|scope of work|appendix|table of contents|contents)$/i;

function precedingHeading(lines: string[], index: number): string | undefined {
  // CONCERN: a short title-case line that is not in the generic-section list can still be stored as the project.
  for (let cursor = index - 1; cursor >= 0 && index - cursor < 30; cursor -= 1) {
    const line = lines[cursor].replace(/\s+/g, " ").trim();
    if (!line || line.includes("$") || line.length > 90) continue;
    if ((line.match(/\|/g) ?? []).length >= 2) continue;
    if (isProseLine(line)) continue;
    const title = line.replace(/^#{1,6}\s+/, "").trim();
    if (!title || GENERIC_SECTION.test(title)) continue;
    return title;
  }
  return undefined;
}

function isProseLine(line: string): boolean {
  if (/^\s*<!--/.test(line)) return true;
  if (/^(hi|hello|dear|good morning|good afternoon|i hope|we hope|please find|thank you)\b/i.test(line)) return true;
  const words = line.replace(/^#{1,6}\s+/, "").trim().split(/\s+/);
  return /[.?!]$/.test(line) && words.length >= 5;
}

const GENERIC_COLUMN = /^(item|description|scope|details|particulars|amount|amounts|price|prices|total|unit|qty|quantity|notes|comments|remarks|base bid|optional|option|options|service|services|no\.?|#)$/i;

function splitTableCells(line: string): string[] {
  const trimmed = line.trim();
  if ((trimmed.match(/\|/g) ?? []).length < 2) return [];
  const cells = trimmed.split("|").map((cell) => cell.replace(/\s+/g, " ").trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
}

function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === "");
}

function cellsMatchAmount(cell: string, value: string): boolean {
  if (!cell.includes("$") || !value.includes("$")) return false;
  const left = Number(amountKey(cell));
  const right = Number(amountKey(value));
  return Number.isFinite(left) && Number.isFinite(right) && left === right && right !== 0;
}

function isSupplierCell(cell: string): boolean {
  const text = stripFactEmphasis(cell).replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > 60) return false;
  if (/[$%]/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/^\d/.test(text)) return false;
  if (/\b(day|days|week|weeks|month|months|year|years)\b/i.test(text)) return false;
  if (GENERIC_COLUMN.test(text)) return false;
  if (/^(no\.?|item description|description|item|scope|alternative|alternatives)$/i.test(text)) return false;
  if (/\b(bid|amount|price|total|optional|percent|difference|delivery|lead time|not provided)\b/i.test(text)) return false;
  return true;
}

type TableRow = { lineIndex: number; line: string; cells: string[] };

type CarriedSupplierHeader = { page: number; cells: string[]; line: string };

type TableMoneyCell = {
  lineIndex: number;
  cellIndex: number;
  line: string;
  cells: string[];
  headerCells: string[];
  bidder?: string;
  headerLine: string;
  headerPage?: number;
};

function isMoneyRow(cells: string[]): boolean {
  return cells.some((cell) => cell.includes("$"));
}

function isSupplierHeader(cells: string[]): boolean {
  if (isMoneyRow(cells)) return false;
  return cells.filter((cell) => isSupplierCell(cell)).length >= 2;
}

function moneyCells(pageText: string, carried?: CarriedSupplierHeader): TableMoneyCell[] {
  return tableBlocks(pageText).flatMap((block, index) => supplierCellsInBlock(block, index === 0 ? carried : undefined));
}

function tableBlocks(pageText: string): TableRow[][] {
  const lines = pageText.split(/\n/);
  const blocks: TableRow[][] = [];
  let block: TableRow[] = [];
  const flush = () => {
    if (block.length === 0) return;
    blocks.push(block);
    block = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const cells = splitTableCells(line);
    if (cells.length >= 2) {
      block.push({ lineIndex: index, line: line.replace(/\s+/g, " ").trim(), cells });
      continue;
    }
    flush();
  }
  flush();
  return blocks;
}

function originalPageText(pages: readonly { pageNumber: number; text: string }[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const page of pages) {
    const prior = map.get(page.pageNumber);
    map.set(page.pageNumber, prior ? `${prior}\n${page.text}` : page.text);
  }
  return map;
}

function statedColumnPage(
  proposed: MeetingsV3ProposedFact,
  pages: Map<number, string>,
  amountPage: number,
): number {
  if (typeof proposed.columnPage !== "number" || !Number.isInteger(proposed.columnPage)) return amountPage;
  if (!pages.has(proposed.columnPage)) return amountPage;
  return proposed.columnPage;
}

function carriedSupplierHeaders(pages: Map<number, string>): Map<number, CarriedSupplierHeader> {
  const carried = new Map<number, CarriedSupplierHeader>();
  const numbers = [...pages.keys()].sort((left, right) => left - right);
  for (let index = 1; index < numbers.length; index += 1) {
    const previous = numbers[index - 1];
    const current = numbers[index];
    if (previous === undefined || current === undefined || current !== previous + 1) continue;
    const header = continuedSupplierHeader(pages.get(previous) ?? "", pages.get(current) ?? "");
    if (!header) continue;
    carried.set(current, { page: previous, cells: header.cells, line: header.line });
  }
  return carried;
}

function continuedSupplierHeader(
  previous: string,
  next: string,
): { cells: string[]; line: string } | undefined {
  const previousLines = significantLines(previous);
  const nextLines = significantLines(next);
  const previousLast = previousLines.at(-1);
  const nextFirst = nextLines[0];
  if (!previousLast || !nextFirst) return undefined;
  if (splitTableCells(previousLast).length < 2 || splitTableCells(nextFirst).length < 2) return undefined;
  const previousBlock = tableBlocks(previous).at(-1);
  const nextBlock = tableBlocks(next)[0];
  if (!previousBlock || !nextBlock || blockOpensWithSupplierHeader(nextBlock)) return undefined;
  const header = activeHeaderOnLastMoneyRow(previousBlock);
  const firstMoney = nextBlock.filter((row) => !isTableSeparator(row.cells)).find((row) => isMoneyRow(row.cells));
  if (!header || !firstMoney || firstMoney.cells.length !== header.cells.length) return undefined;
  const previousNumber = lastRowNumber(previousBlock);
  const nextNumber = leadingRowNumber(firstMoney.cells);
  if (previousNumber === undefined || nextNumber === undefined || nextNumber <= previousNumber) return undefined;
  return header;
}

function significantLines(text: string): string[] {
  return text.split(/\n/).map((line) => line.trim()).filter((line) => line && !isPageFurniture(line));
}

function isPageFurniture(line: string): boolean {
  // A printed page number under the table is not a new section.
  return /^\d{1,4}$/.test(line) || /^page\s+\d{1,4}$/i.test(line);
}

function blockOpensWithSupplierHeader(rows: readonly TableRow[]): boolean {
  for (const row of rows) {
    if (isTableSeparator(row.cells)) continue;
    if (isSupplierHeader(row.cells)) return true;
    if (isMoneyRow(row.cells)) return false;
  }
  return false;
}

function activeHeaderOnLastMoneyRow(rows: readonly TableRow[]): { cells: string[]; line: string } | undefined {
  const last = supplierCellsInBlock(rows).at(-1);
  if (!last?.bidder) return undefined;
  return { cells: last.headerCells, line: last.headerLine };
}

function lastRowNumber(rows: readonly TableRow[]): number | undefined {
  const money = rows.filter((row) => !isTableSeparator(row.cells) && isMoneyRow(row.cells));
  const last = money.at(-1);
  return last ? leadingRowNumber(last.cells) : undefined;
}

function leadingRowNumber(cells: readonly string[]): number | undefined {
  const first = stripFactEmphasis(cells[0] ?? "").replace(/\s+/g, " ").trim();
  if (!/^\d+(?:\.\d+)?$/.test(first)) return undefined;
  const value = Number(first);
  return Number.isFinite(value) ? value : undefined;
}

function supplierCellsInBlock(rows: readonly TableRow[], carried?: CarriedSupplierHeader): TableMoneyCell[] {
  const body = rows.filter((row) => !isTableSeparator(row.cells));
  const headerIndexes = body.flatMap((row, index) => (isSupplierHeader(row.cells) ? [index] : []));
  const active = new Map<number, { cells: string[]; line: string; page?: number }>();
  if (carried && !blockOpensWithSupplierHeader(body)) {
    const firstHeader = headerIndexes[0] ?? body.length;
    for (let index = 0; index < firstHeader; index += 1) {
      const row = body[index];
      if (!row || !isMoneyRow(row.cells) || row.cells.length !== carried.cells.length) continue;
      active.set(row.lineIndex, { cells: carried.cells, line: carried.line, page: carried.page });
    }
  }
  for (const headerIndex of headerIndexes) {
    const header = body[headerIndex];
    if (!header) continue;
    let applies = false;
    for (let cursor = headerIndex + 1; cursor < body.length; cursor += 1) {
      const row = body[cursor];
      if (!row) continue;
      if (isSupplierHeader(row.cells)) break;
      if (isMoneyRow(row.cells)) {
        applies = true;
        break;
      }
    }
    if (!applies) continue;
    for (let cursor = headerIndex + 1; cursor < body.length; cursor += 1) {
      const row = body[cursor];
      if (!row || isSupplierHeader(row.cells)) break;
      active.set(row.lineIndex, { cells: header.cells, line: header.line });
    }
  }
  const cells: TableMoneyCell[] = [];
  for (const row of body) {
    const header = active.get(row.lineIndex);
    if (!header || !isMoneyRow(row.cells)) continue;
    row.cells.forEach((cell, cellIndex) => {
      if (!cell.includes("$")) return;
      const headerCell = stripFactEmphasis(header.cells[cellIndex] ?? "").replace(/\s+/g, " ").trim();
      cells.push({
        lineIndex: row.lineIndex,
        cellIndex,
        line: row.line,
        cells: row.cells,
        headerCells: header.cells,
        bidder: isSupplierCell(headerCell) ? headerCell : undefined,
        headerLine: header.line,
        headerPage: header.page,
      });
    });
  }
  return cells;
}

function rowLabel(cells: string[], headerCells: string[]): string | undefined {
  let label = "";
  for (let index = 0; index < cells.length; index += 1) {
    if (isSupplierCell(headerCells[index] ?? "")) break;
    const text = tidyFactLabel(cells[index] ?? "");
    if (!text || text.includes("$") || /^\d+(?:\.\d+)?$/.test(text)) continue;
    if (text.length >= 3 && text.length <= 400) label = text;
  }
  return label || undefined;
}

function citationMatchesLine(line: string, candidate: MeetingsV3FactCandidate): boolean {
  const haystack = normalizeFactText(line);
  const row = candidate.rowQuote ? normalizeFactText(candidate.rowQuote) : "";
  const quote = normalizeFactText(candidate.quote);
  if (row && haystack.includes(row)) return true;
  return Boolean(quote) && haystack.includes(quote);
}

/**
 * Copies one supplier header onto every money row in that table.
 * A later header replaces it only when that header has prices under it.
 * A cited cell can support more than one quotation. Equal prices in one row are paired left to right only when the quotation does not name the column.
 * A repeated amount on another row is left alone unless the quotation names that row.
 */
function applyTableColumns(
  candidate: MeetingsV3FactCandidate,
  pageText: string,
  claimedCells: Set<string>,
  carried?: CarriedSupplierHeader,
): void {
  if (candidate.field !== "amount") return;
  const matches = moneyCells(pageText, carried).filter((cell) => cellsMatchAmount(cell.cells[cell.cellIndex] ?? "", candidate.value));
  if (matches.length === 0) return;
  const cited = matches.filter((cell) => citationMatchesLine(cell.line, candidate));
  const pool = cited.length > 0 ? cited : matches;
  let choice = pool.find((cell) => cell.bidder && candidate.bidder && factLabelKey(cell.bidder) === factLabelKey(candidate.bidder));
  let bookkeeping = false;
  if (!choice && pool.length === 1) choice = pool[0];
  if (!choice && pool.length > 1 && new Set(pool.map((cell) => cell.lineIndex)).size === 1) {
    // CONCERN: when one row repeats a price and the quotation does not name the column, facts are paired left to right in the order they were proposed.
    const open = pool.filter((cell) => !claimedCells.has(`${candidate.page}:${cell.lineIndex}:${cell.cellIndex}`));
    choice = open[0];
    bookkeeping = true;
  }
  if (!choice?.bidder) return;
  if (bookkeeping) claimedCells.add(`${candidate.page}:${choice.lineIndex}:${choice.cellIndex}`);
  if (!candidate.columnQuote) candidate.columnQuote = choice.headerLine;
  if (choice.headerPage && choice.headerPage !== candidate.page) candidate.columnPage = choice.headerPage;
  if (!candidate.rowQuote) candidate.rowQuote = choice.line;
  if (!candidate.bidder) candidate.bidder = choice.bidder;
  const service = rowLabel(choice.cells, choice.headerCells);
  if (service && (!candidate.service || GENERIC_SERVICE.test(candidate.service) || candidate.service.includes("|"))) {
    candidate.service = service;
  }
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

/** One recovery call: the unresolved facts and the issues those facts still raise. */
export type MeetingsV3RecoveryBatch = {
  facts: MeetingsV3FactCandidate[];
  issues: MeetingsV3FactReview[];
};

/**
 * Groups unresolved facts into recovery calls of at most `maxIssues`.
 * A clear fact is left out. A missing bidder and a real price conflict are included.
 * An empty list means there is nothing to repair.
 */
export function recoveryFactBatches(
  candidates: readonly MeetingsV3FactCandidate[],
  maxIssues = FACT_RECOVERY_MAX_ISSUES,
): MeetingsV3RecoveryBatch[] {
  if (maxIssues < 1) return [];
  const divided = dividedAmountSet(candidates);
  const flagged = candidates.filter((candidate) => candidateNeedsRecovery(candidate, divided));
  const batches: MeetingsV3RecoveryBatch[] = [];
  for (let offset = 0; offset < flagged.length; offset += maxIssues) {
    const facts = flagged.slice(offset, offset + maxIssues);
    batches.push({ facts, issues: reviewFacts(facts) });
  }
  return batches;
}

function dividedAmountSet(candidates: readonly MeetingsV3FactCandidate[]): Set<MeetingsV3FactCandidate> {
  const groups = new Map<string, MeetingsV3FactCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.field !== "amount" || !candidate.subject || !candidate.service) continue;
    const key = priceGroupKey(candidate);
    const rows = groups.get(key) ?? [];
    rows.push(candidate);
    groups.set(key, rows);
  }
  const divided = new Set<MeetingsV3FactCandidate>();
  for (const rows of groups.values()) {
    const values = new Set(rows.map((row) => normalizeFactText(row.value)));
    if (values.size > 1) {
      for (const row of rows) divided.add(row);
    }
  }
  return divided;
}

function candidateNeedsRecovery(
  candidate: MeetingsV3FactCandidate,
  divided: ReadonlySet<MeetingsV3FactCandidate>,
): boolean {
  if (candidate.field === "amount" && amountNeedsContext(candidate)) return true;
  if (candidate.topicMismatch) return true;
  if (divided.has(candidate)) return true;
  return candidate.field === "vendor" && candidate.organizationMatch === "ambiguous";
}

/**
 * Replaces the stored fact with the same field, page, quote, amount, and bidder.
 * `revisedQuote` changes that citation. `omit` drops that fact.
 * Another amount, or the same amount from another supplier, stays.
 */
export function mergeProposedFacts(
  base: readonly MeetingsV3ProposedFact[],
  recovered: readonly MeetingsV3ProposedFact[],
): MeetingsV3ProposedFact[] {
  const next = [...base];
  for (const fact of recovered) {
    const index = storedFactIndex(next, fact);
    if (fact.omit === true) {
      if (index >= 0) next.splice(index, 1);
      continue;
    }
    const repaired = applyRevisedQuote(fact);
    if (index >= 0) next[index] = { ...next[index], ...repaired };
    else next.push(repaired);
  }
  return next;
}

function storedFactIndex(rows: readonly MeetingsV3ProposedFact[], fact: MeetingsV3ProposedFact): number {
  const hits = rows.flatMap((row, index) => (sameProposedCore(row, fact) ? [index] : []));
  const bidder = proposedBidderKey(fact);
  if (bidder) {
    const named = hits.find((index) => proposedBidderKey(rows[index] ?? {}) === bidder);
    if (named !== undefined) return named;
    const open = hits.find((index) => !proposedBidderKey(rows[index] ?? {}));
    return open ?? -1;
  }
  return hits.length === 1 ? hits[0]! : -1;
}

function applyRevisedQuote(fact: MeetingsV3ProposedFact): MeetingsV3ProposedFact {
  if (typeof fact.revisedQuote !== "string" || !fact.revisedQuote.trim()) return fact;
  const quote = fact.revisedQuote.replace(/\s+/g, " ").trim();
  const rest = { ...fact };
  delete rest.revisedQuote;
  return { ...rest, quote };
}

function proposedBidderKey(fact: MeetingsV3ProposedFact): string {
  return typeof fact.bidder === "string" ? factLabelKey(fact.bidder) : "";
}

function sameProposedCore(left: MeetingsV3ProposedFact, right: MeetingsV3ProposedFact): boolean {
  if (left.field !== right.field || left.page !== right.page) return false;
  if (typeof left.quote !== "string" || typeof right.quote !== "string") return false;
  if (typeof left.value !== "string" || typeof right.value !== "string") return false;
  return normalizeFactText(left.quote) === normalizeFactText(right.quote)
    && normalizeFactText(left.value) === normalizeFactText(right.value);
}
