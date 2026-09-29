/**
 * Bid rows read from agenda pages, plus the arithmetic that checks them.
 * The page decides the cell. This module never expands a spoken number.
 */

/** Last agenda page used when the meeting has no agenda/attachment split. */
export const QUOTE_LEDGER_AGENDA_PAGE_CAP = 15;

export const QUOTE_LINE_KINDS = ["base", "optional", "total", "alternative"] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export const QUOTE_TAX_BASES = ["plus_hst", "hst_included", "unspecified"] as const;
export type QuoteTaxBasis = (typeof QUOTE_TAX_BASES)[number];

export const QUOTE_CHECK_STATUSES = ["ok", "mismatch", "incomplete", "unchecked"] as const;
export type QuoteCheckStatus = (typeof QUOTE_CHECK_STATUSES)[number];

/** One money cell on one agenda page. */
export type QuoteRow = {
  pageNumber: number;
  itemLabel: string;
  vendor: string;
  equipment: string | null;
  lineKind: QuoteLineKind;
  amountCents: number;
  taxBasis: QuoteTaxBasis;
};

/** A quote row plus the arithmetic result for its vendor group. */
export type AnnotatedQuoteRow = QuoteRow & {
  checkStatus: QuoteCheckStatus;
  checkDetail: string;
};

/** A model cell that was not stored, with the reason. */
export type RejectedQuoteCell = {
  pageNumber: number;
  reason: string;
};

/**
 * Agenda page numbers the ledger reads.
 * A recorded split is the boundary. Without one, reading stops at page 15.
 */
export function quoteLedgerPageNumbers(
  pageNumbers: number[],
  agendaContentEndsAtPage: number | null,
): number[] {
  // CONCERN: a package whose agenda continues past page 15, and has no recorded split, is truncated.
  const last = agendaContentEndsAtPage ?? QUOTE_LEDGER_AGENDA_PAGE_CAP;
  return [...new Set(pageNumbers)]
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= last)
    .sort((left, right) => left - right);
}

/**
 * True when pages past the cap exist and no split marked them as attachments.
 * Those pages are not read.
 */
export function quoteLedgerTruncated(
  pageNumbers: number[],
  agendaContentEndsAtPage: number | null,
): boolean {
  if (agendaContentEndsAtPage != null) return false;
  return pageNumbers.some(
    (page) => Number.isInteger(page) && page > QUOTE_LEDGER_AGENDA_PAGE_CAP,
  );
}

/**
 * The only dollar figure in `value`, in cents.
 * Returns null when the text is empty, has letters, or contains more than one figure.
 */
export function parseQuoteAmountCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[a-z%]/i.test(trimmed)) return null;
  const matches = [
    ...trimmed.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g),
  ];
  if (matches.length !== 1) return null;
  const whole = Number(matches[0][1]!.replace(/,/g, ""));
  if (!Number.isInteger(whole)) return null;
  const fraction = matches[0][2] ? matches[0][2].padEnd(2, "0") : "00";
  return whole * 100 + Number(fraction);
}

/**
 * Reads the model JSON for one page.
 * Throws when the payload is not an object with a rows array.
 * A cell with two figures, or no figure, is returned in `rejected` and not stored.
 */
export function parseQuoteLedgerModelJson(
  pageNumber: number,
  raw: string,
): { rows: QuoteRow[]; rejected: RejectedQuoteCell[] } {
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.rows)) {
    throw new Error(`Quote ledger page ${pageNumber} did not return a rows array.`);
  }
  const rows: QuoteRow[] = [];
  const rejected: RejectedQuoteCell[] = [];
  for (const entry of parsed.rows) {
    const row = parseModelRow(pageNumber, entry);
    if (row.ok) rows.push(row.row);
    else rejected.push({ pageNumber, reason: row.reason });
  }
  return { rows, rejected };
}

/**
 * Checks base + optional items against the stated total for each vendor.
 * Alternative rows are not added into that total.
 */
export function annotateQuoteRows(rows: QuoteRow[]): AnnotatedQuoteRow[] {
  const groups = new Map<string, QuoteCheck>();
  for (const row of rows) {
    if (row.lineKind === "alternative") continue;
    const key = groupKey(row);
    const existing = groups.get(key);
    if (existing) continue;
    groups.set(key, checkVendorGroup(rows.filter((candidate) => groupKey(candidate) === key && candidate.lineKind !== "alternative")));
  }
  return rows.map((row) => {
    if (row.lineKind === "alternative") {
      return { ...row, checkStatus: "unchecked", checkDetail: "" };
    }
    const check = groups.get(groupKey(row)) ?? {
      checkStatus: "incomplete" as const,
      checkDetail: "This vendor has no base bid to check.",
    };
    return { ...row, ...check };
  });
}

/** Counts of arithmetic results across annotated rows. */
export function summarizeQuoteChecks(rows: AnnotatedQuoteRow[]): Record<QuoteCheckStatus, number> {
  const summary: Record<QuoteCheckStatus, number> = {
    ok: 0,
    mismatch: 0,
    incomplete: 0,
    unchecked: 0,
  };
  for (const row of rows) summary[row.checkStatus] += 1;
  return summary;
}

/**
 * Instructions for the page reader. The attached page wins over the extracted text.
 */
export const QUOTE_LEDGER_SYSTEM_PROMPT = `You read one page of a condominium board package and list the bid amounts printed on that page.

The attached PDF is the page. A prior text extraction is included and may have shifted table cells. When the extraction and the page disagree, follow the page.

Return JSON only:
{"rows":[{"itemLabel":"string","vendor":"string","equipment":"string or null","lineKind":"base|optional|total|alternative","amount":"1000.00","taxBasis":"plus_hst|hst_included|unspecified"}]}

Rules:
- One row is one money cell. One amount per row.
- itemLabel is the agenda heading the bids belong to.
- vendor is the contractor named for that column.
- equipment is the product named for that cell, or null when the cell is not tied to a named product.
- lineKind base is the specified bid. optional is an add-on. total is the specified bid plus its add-ons. alternative is a substitute-product bid.
- Skip empty cells, cells that say not provided, lead times, percentages, and prose that is not a bid.
- Do not invent a vendor or an amount that is not printed on the page.
- taxBasis is plus_hst when the page says the figure is plus HST, hst_included when the tax is inside the figure, otherwise unspecified.
- When the page has no bids, return {"rows":[]}.`;

type QuoteCheck = { checkStatus: QuoteCheckStatus; checkDetail: string };

function groupKey(row: QuoteRow): string {
  return `${row.pageNumber}\0${row.itemLabel.trim().toLowerCase()}\0${row.vendor.trim().toLowerCase()}`;
}

function checkVendorGroup(rows: QuoteRow[]): QuoteCheck {
  const bases = rows.filter((row) => row.lineKind === "base");
  const optionals = rows.filter((row) => row.lineKind === "optional");
  const totals = rows.filter((row) => row.lineKind === "total");
  if (bases.length > 1) {
    return { checkStatus: "mismatch", checkDetail: "This vendor has more than one base bid." };
  }
  if (totals.length > 1) {
    return { checkStatus: "mismatch", checkDetail: "This vendor has more than one total." };
  }
  if (bases.length === 0 && totals.length === 0) {
    return { checkStatus: "incomplete", checkDetail: "This vendor has no base bid or total to check." };
  }
  if (bases.length === 0) {
    return { checkStatus: "incomplete", checkDetail: "This vendor has a total and no base bid." };
  }
  if (totals.length === 0) {
    return { checkStatus: "incomplete", checkDetail: "This vendor has a base bid and no total." };
  }
  const base = bases[0]!.amountCents;
  const optional = optionals.reduce((sum, row) => sum + row.amountCents, 0);
  const total = totals[0]!.amountCents;
  const expected = base + optional;
  if (expected === total) {
    return { checkStatus: "ok", checkDetail: "Base plus optional items equals the total." };
  }
  return {
    checkStatus: "mismatch",
    checkDetail: `Base ${formatCents(base)} plus optional items ${formatCents(optional)} is ${formatCents(expected)}. The stated total is ${formatCents(total)}.`,
  };
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const body = first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Quote ledger response was not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseModelRow(
  pageNumber: number,
  entry: unknown,
): { ok: true; row: QuoteRow } | { ok: false; reason: string } {
  if (!entry || typeof entry !== "object") {
    return { ok: false, reason: "A row was not an object." };
  }
  const record = entry as Record<string, unknown>;
  const itemLabel = typeof record.itemLabel === "string" ? record.itemLabel.trim() : "";
  const vendor = typeof record.vendor === "string" ? record.vendor.trim() : "";
  if (!itemLabel || !vendor) {
    return { ok: false, reason: "A row is missing an item label or a vendor." };
  }
  const lineKind = record.lineKind;
  if (!isLineKind(lineKind)) {
    return { ok: false, reason: `Vendor ${vendor} has a line kind that is not a bid row.` };
  }
  const amountCents = parseQuoteAmountCents(record.amount);
  if (amountCents == null) {
    return { ok: false, reason: `Vendor ${vendor} did not have a single amount.` };
  }
  const taxBasis = record.taxBasis == null || record.taxBasis === ""
    ? "unspecified"
    : record.taxBasis;
  if (!isTaxBasis(taxBasis)) {
    return { ok: false, reason: `Vendor ${vendor} has an unknown tax basis.` };
  }
  const equipment = typeof record.equipment === "string" && record.equipment.trim()
    ? record.equipment.trim()
    : null;
  return {
    ok: true,
    row: { pageNumber, itemLabel, vendor, equipment, lineKind, amountCents, taxBasis },
  };
}

function isLineKind(value: unknown): value is QuoteLineKind {
  return typeof value === "string" && (QUOTE_LINE_KINDS as readonly string[]).includes(value);
}

function isTaxBasis(value: unknown): value is QuoteTaxBasis {
  return typeof value === "string" && (QUOTE_TAX_BASES as readonly string[]).includes(value);
}
