/**
 * Rewrites every stored package page from that page's PDF.
 * The stored extraction is the style to keep. The page PDF is what the rewrite follows.
 * Docling text is left unchanged.
 */

import { randomUUID } from "crypto";

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2DocumentPages, meetingsV3PageRewrites } from "@/lib/db/schema-v2";
import { generatePageVision } from "@/lib/gemini/client";
import { readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { loadMeetingBoardPackage } from "@/lib/meeting-v2/board-package";
import { extractPdfPages } from "@/lib/pdf/extract-pages";
import { isMeetingsV3Workspace } from "@/lib/meeting-v3/workspace";
import { PAGE_REWRITE_SYSTEM_PROMPT, readPageRewriteMarkdown } from "@/lib/meeting-v3/page-rewrite";

/** A page-rewrite failure the route can return with an HTTP status. */
export class PageRewriteError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PageRewriteError";
    this.status = status;
  }
}

/** One stored rewrite. */
export type PageRewrite = {
  pageNumber: number;
  correctedText: string;
};

/** The rewrites stored for one meeting after a build. */
export type PageRewriteBuildResult = {
  meetingId: string;
  pageCount: number;
  pages: PageRewrite[];
};

/**
 * Replaces the meeting's page rewrites with a fresh read of each extracted page.
 * Throws PageRewriteError when the meeting, pages, or PDF are missing.
 * A page that does not return markdown leaves the previous rewrites in place.
 */
export async function buildMeetingPageRewrites(meetingId: string): Promise<PageRewriteBuildResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  if (!meeting || !isMeetingsV3Workspace(readMeetingV2Settings(meeting.settings))) {
    throw new PageRewriteError("Meeting not found.", 404);
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
    throw new PageRewriteError("No extracted board-package pages for this meeting.", 409);
  }

  const pdf = await loadMeetingBoardPackage(meetingId);
  if (!pdf.ok) {
    throw new PageRewriteError(pdf.error, pdf.status);
  }

  const rewritten: PageRewrite[] = [];
  for (const page of pages) {
    let pagePdf: Uint8Array;
    try {
      pagePdf = await extractPdfPages(pdf.payload.buffer, [page.pageNumber]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown PDF error";
      throw new PageRewriteError(`Could not copy page ${page.pageNumber}. ${detail}`, 422);
    }
    const completion = await generatePageVision({
      systemInstruction: PAGE_REWRITE_SYSTEM_PROMPT,
      userText: pageRewriteUserText(page.pageNumber, page.extractedText),
      fileParts: [{
        mimeType: "application/pdf",
        data: Buffer.from(pagePdf),
        label: `board-package-page-${page.pageNumber}.pdf`,
      }],
      maxOutputTokens: 16384,
    });
    if (completion.truncated) {
      throw new PageRewriteError(
        `Page ${page.pageNumber} rewrite was cut off. The stored rewrites were left unchanged.`,
        502,
      );
    }
    try {
      rewritten.push({
        pageNumber: page.pageNumber,
        correctedText: readPageRewriteMarkdown(completion.text),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unreadable response";
      throw new PageRewriteError(
        `Page ${page.pageNumber} rewrite could not be read. ${detail} The stored rewrites were left unchanged.`,
        502,
      );
    }
  }

  const createdAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.delete(meetingsV3PageRewrites).where(eq(meetingsV3PageRewrites.meetingV2Id, meetingId));
    await tx.insert(meetingsV3PageRewrites).values(
      rewritten.map((page) => ({
        id: randomUUID(),
        meetingV2Id: meetingId,
        pageNumber: page.pageNumber,
        correctedText: page.correctedText,
        createdAt,
      })),
    );
  });

  return { meetingId, pageCount: rewritten.length, pages: rewritten };
}

/**
 * The rewritten pages stored for a meeting, in page order.
 */
export async function listMeetingPageRewrites(meetingId: string): Promise<PageRewrite[]> {
  const db = getDb();
  return db
    .select({
      pageNumber: meetingsV3PageRewrites.pageNumber,
      correctedText: meetingsV3PageRewrites.correctedText,
    })
    .from(meetingsV3PageRewrites)
    .where(eq(meetingsV3PageRewrites.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3PageRewrites.pageNumber));
}

function pageRewriteUserText(pageNumber: number, extractedText: string): string {
  const text = extractedText.length > 20_000
    ? `${extractedText.slice(0, 20_000)}\n[extraction truncated]`
    : extractedText;
  return [
    `Page number: ${pageNumber}`,
    "The attached file is this page only.",
    "Prior Docling extraction (table columns may be shifted; keep this markdown style; the attached page wins):",
    text || "[no extracted text]",
  ].join("\n");
}
