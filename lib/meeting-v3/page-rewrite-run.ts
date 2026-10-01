/**
 * Rewrites agenda pages, and attachment pages whose extract stacks several fees on one line, from each page's PDF.
 * Other attachment pages keep the Docling extract. The stored extraction is the style to keep.
 */

import { randomUUID } from "crypto";

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2DocumentPages,
  meetingsV3AgendaItems,
  meetingsV3PageRewrites,
} from "@/lib/db/schema-v2";
import { generatePageVision } from "@/lib/gemini/client";
import { readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { upcomingAgendaSplit } from "@/lib/meeting-v2/upcoming-meeting";
import { isAgendaPageForCorrection, pageNeedsTableCorrection } from "@/lib/meeting-v3/agenda-pages";
import { loadMeetingBoardPackage } from "@/lib/meeting-v2/board-package";
import { extractPdfPages } from "@/lib/pdf/extract-pages";
import { meetingsV3SettingsWithAttachmentLink } from "@/lib/meeting-v3/package-status";
import { isMeetingsV3Workspace } from "@/lib/meeting-v3/workspace";
import {
  buildMeetingsV3GeminiStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import { PAGE_REWRITE_SYSTEM_PROMPT, readPageRewriteMarkdown } from "@/lib/meeting-v3/page-rewrite";
import type { GeminiUsageCall } from "@/lib/gemini/usage";

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
 * Replaces the meeting's page rewrites with a fresh read of each agenda page.
 * Throws PageRewriteError when the meeting, pages, or PDF are missing.
 * A page that does not return markdown leaves the previous rewrites in place.
 * A successful rewrite drops the stored V3 agenda, which was built from the previous correction.
 */
export async function buildMeetingPageRewrites(meetingId: string): Promise<PageRewriteBuildResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(meeting?.settings);
  if (!meeting || !isMeetingsV3Workspace(settings)) {
    throw new PageRewriteError("Meeting not found.", 404);
  }
  const agendaSplit = upcomingAgendaSplit(settings);

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

  const agendaPages = pages.filter((page) =>
    isAgendaPageForCorrection(page.pageNumber, agendaSplit)
    || pageNeedsTableCorrection(page.extractedText),
  );
  if (agendaPages.length === 0) {
    throw new PageRewriteError("No agenda pages are available to correct.", 409);
  }

  const rewritten: PageRewrite[] = [];
  const usageCalls: GeminiUsageCall[] = [];
  for (const page of agendaPages) {
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
    usageCalls.push(...completion.usageCalls);
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
    await tx.delete(meetingsV3AgendaItems).where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId));
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
    const [stored] = await tx
      .select({ settings: meetingsV2.settings })
      .from(meetingsV2)
      .where(eq(meetingsV2.id, meetingId));
    await tx
      .update(meetingsV2)
      .set({
        settings: meetingsV3SettingsWithAttachmentLink(readMeetingV2Settings(stored?.settings), null),
        updatedAt: createdAt,
      })
      .where(eq(meetingsV2.id, meetingId));
  });

  if (usageCalls.length > 0) {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3GeminiStageRow("v3_correct", usageCalls),
    );
  }

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
