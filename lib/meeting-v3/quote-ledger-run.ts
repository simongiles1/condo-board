/**
 * Builds a meeting's quote ledger from agenda-page PDFs and the stored extraction.
 * The stored extraction is context. The page PDF is what the reader follows.
 */

import { randomUUID } from "crypto";

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2DocumentPages, meetingsV3QuoteRows } from "@/lib/db/schema-v2";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { loadMeetingBoardPackage } from "@/lib/meeting-v2/board-package";
import { upcomingAgendaSplit } from "@/lib/meeting-v2/upcoming-meeting";
import { extractPdfPages } from "@/lib/pdf/extract-pages";
import {
  annotateQuoteRows,
  parseQuoteLedgerModelJson,
  QUOTE_LEDGER_SYSTEM_PROMPT,
  quoteLedgerPageNumbers,
  quoteLedgerTruncated,
  summarizeQuoteChecks,
  type AnnotatedQuoteRow,
  type QuoteCheckStatus,
  type QuoteRow,
  type RejectedQuoteCell,
} from "@/lib/meeting-v3/quote-ledger";

/** A quote-ledger failure the route can return with an HTTP status. */
export class QuoteLedgerError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "QuoteLedgerError";
    this.status = status;
  }
}

/** The ledger stored for one meeting after a build. */
export type QuoteLedgerBuildResult = {
  meetingId: string;
  pageNumbers: number[];
  truncated: boolean;
  rowCount: number;
  checks: Record<QuoteCheckStatus, number>;
  rejected: RejectedQuoteCell[];
  rows: AnnotatedQuoteRow[];
};

/**
 * Replaces the meeting's quote rows with a fresh read of each agenda page.
 * Throws QuoteLedgerError when the meeting, pages, or PDF are missing.
 * A page that does not return a rows array leaves the previous ledger in place.
 */
export async function buildMeetingQuoteLedger(meetingId: string): Promise<QuoteLedgerBuildResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  if (!meeting) {
    throw new QuoteLedgerError("Meeting not found.", 404);
  }

  const pages = await db
    .select({
      pageNumber: meetingsV2DocumentPages.pageNumber,
      extractedText: meetingsV2DocumentPages.extractedText,
    })
    .from(meetingsV2DocumentPages)
    .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2DocumentPages.pageNumber));
  if (pages.length === 0) {
    throw new QuoteLedgerError("No extracted board-package pages for this meeting.", 409);
  }

  const split = upcomingAgendaSplit(meeting.settings);
  const pageNumbers = quoteLedgerPageNumbers(
    pages.map((page) => page.pageNumber),
    split,
  );
  if (pageNumbers.length === 0) {
    throw new QuoteLedgerError("The agenda window has no pages to read.", 409);
  }

  const pdf = await loadMeetingBoardPackage(meetingId);
  if (!pdf.ok) {
    throw new QuoteLedgerError(pdf.error, pdf.status);
  }

  const textByPage = new Map(pages.map((page) => [page.pageNumber, page.extractedText]));
  const rejected: RejectedQuoteCell[] = [];
  const rawRows: QuoteRow[] = [];
  for (const pageNumber of pageNumbers) {
    let pagePdf: Uint8Array;
    try {
      pagePdf = await extractPdfPages(pdf.payload.buffer, [pageNumber]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown PDF error";
      throw new QuoteLedgerError(`Could not copy agenda page ${pageNumber}. ${detail}`, 422);
    }
    const completion = await generateEmailExtraction({
      systemInstruction: QUOTE_LEDGER_SYSTEM_PROMPT,
      userText: quoteLedgerUserText(pageNumber, textByPage.get(pageNumber) ?? ""),
      fileParts: [{
        mimeType: "application/pdf",
        data: Buffer.from(pagePdf),
        label: `agenda-page-${pageNumber}.pdf`,
      }],
      maxOutputTokens: 8192,
      step: "quote_ledger",
    });
    try {
      const parsed = parseQuoteLedgerModelJson(pageNumber, completion.text);
      rawRows.push(...parsed.rows);
      rejected.push(...parsed.rejected);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unreadable response";
      throw new QuoteLedgerError(
        `Quote ledger page ${pageNumber} could not be read. ${detail} The stored ledger was left unchanged.`,
        502,
      );
    }
  }

  const rows = annotateQuoteRows(rawRows);
  const createdAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.delete(meetingsV3QuoteRows).where(eq(meetingsV3QuoteRows.meetingV2Id, meetingId));
    if (rows.length > 0) {
      await tx.insert(meetingsV3QuoteRows).values(
        rows.map((row) => ({
          id: randomUUID(),
          meetingV2Id: meetingId,
          pageNumber: row.pageNumber,
          itemLabel: row.itemLabel,
          vendor: row.vendor,
          equipment: row.equipment,
          lineKind: row.lineKind,
          amountCents: row.amountCents,
          taxBasis: row.taxBasis,
          checkStatus: row.checkStatus,
          checkDetail: row.checkDetail,
          createdAt,
        })),
      );
    }
  });

  return {
    meetingId,
    pageNumbers,
    truncated: quoteLedgerTruncated(pages.map((page) => page.pageNumber), split),
    rowCount: rows.length,
    checks: summarizeQuoteChecks(rows),
    rejected,
    rows,
  };
}

/**
 * The quote rows stored for a meeting, in page order.
 */
export async function listMeetingQuoteRows(meetingId: string): Promise<AnnotatedQuoteRow[]> {
  const db = getDb();
  const stored = await db
    .select({
      pageNumber: meetingsV3QuoteRows.pageNumber,
      itemLabel: meetingsV3QuoteRows.itemLabel,
      vendor: meetingsV3QuoteRows.vendor,
      equipment: meetingsV3QuoteRows.equipment,
      lineKind: meetingsV3QuoteRows.lineKind,
      amountCents: meetingsV3QuoteRows.amountCents,
      taxBasis: meetingsV3QuoteRows.taxBasis,
      checkStatus: meetingsV3QuoteRows.checkStatus,
      checkDetail: meetingsV3QuoteRows.checkDetail,
    })
    .from(meetingsV3QuoteRows)
    .where(eq(meetingsV3QuoteRows.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3QuoteRows.pageNumber), asc(meetingsV3QuoteRows.vendor));
  return stored;
}

function quoteLedgerUserText(pageNumber: number, extractedText: string): string {
  const text = extractedText.length > 20_000
    ? `${extractedText.slice(0, 20_000)}\n[extraction truncated]`
    : extractedText;
  return [
    `Page number: ${pageNumber}`,
    "The attached file is this page only.",
    "Prior extraction (table columns may be shifted; the attached page wins):",
    text || "[no extracted text]",
  ].join("\n");
}
