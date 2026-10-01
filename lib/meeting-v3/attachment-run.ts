/**
 * Links attachment pages onto a V3 agenda.
 * V2 agenda rows and the V2 attachment assignment are not written.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2DocumentPages, meetingsV3AgendaItems } from "@/lib/db/schema-v2";
import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { isDeepSeekKeyConfigured, readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { upcomingAgendaSplit } from "@/lib/meeting-v2/upcoming-meeting";
import {
  linkCorrectedAttachmentPages,
  attachmentPageNumbersToLink,
  readAttachmentAssignments,
  selectCorrectedAttachmentPages,
} from "@/lib/meeting-v3/attachment-pages";
import { listMeetingV3Agenda, type MeetingsV3AgendaItem } from "@/lib/meeting-v3/agenda-run";
import { listMeetingPageRewrites } from "@/lib/meeting-v3/page-rewrite-run";
import { writeMeetingsV3AttachmentLink } from "@/lib/meeting-v3/package-status";
import { readAgendaSourcePages } from "@/lib/meeting-v3/agenda-pages";
import type { DeepSeekGenerationResult } from "@/lib/deepseek/client";
import {
  buildMeetingsV3DeepSeekStageRow,
  buildMeetingsV3NotApplicableStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import { isMeetingsV3Workspace } from "@/lib/meeting-v3/workspace";

/** An attachment link the route can return with an HTTP status. */
export class AttachmentLinkError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AttachmentLinkError";
    this.status = status;
  }
}

/** The link stored for one meeting. */
export type AttachmentLinkResult = {
  meetingId: string;
  assignedPageCount: number;
  unassignedPages: number[];
  pagesWithoutText: number[];
  items: MeetingsV3AgendaItem[];
};

const ATTACHMENT_ASSIGNMENT_PROMPT = `You link condominium board-package attachment pages to agenda items.
The agenda itself is already extracted. These pages are supporting material after the agenda, corrected from the PDF.
Return JSON only: {"assignments":[{"agendaItemId":"<id>","pages":[13]}]}.
Rules:
- Use only agendaItemId values and pageNumber values from the input.
- Each page belongs to at most one agenda item.
- Match the page to the agenda item it supports (the matter named in the heading or body).
- Omit a page when it does not support any listed item.`;

/**
 * Replaces attachment pages on the V3 agenda using corrected text.
 * A page the agenda already names is linked before any model call, including a page with no extracted text.
 * Throws AttachmentLinkError when the meeting or agenda is not ready.
 * A model failure leaves the previous pages in place.
 * A page with no text that the agenda does not name stays unlinked instead of failing the run.
 */
export async function linkMeetingV3Attachments(meetingId: string): Promise<AttachmentLinkResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  if (!meeting || !isMeetingsV3Workspace(readMeetingV2Settings(meeting.settings))) {
    throw new AttachmentLinkError("Meeting not found.", 404);
  }

  const itemRows = await db
    .select({
      id: meetingsV3AgendaItems.id,
      sourcePagesJson: meetingsV3AgendaItems.sourcePagesJson,
      summary: meetingsV3AgendaItems.summary,
      itemNumber: meetingsV3AgendaItems.itemNumber,
      title: meetingsV3AgendaItems.title,
    })
    .from(meetingsV3AgendaItems)
    .where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3AgendaItems.sortOrder));
  if (itemRows.length === 0) {
    throw new AttachmentLinkError("Build the agenda before linking attachment pages.", 409);
  }

  const storedPages = await db
    .select({
      pageNumber: meetingsV2DocumentPages.pageNumber,
      heading: meetingsV2DocumentPages.pageHeading,
      extractedText: meetingsV2DocumentPages.extractedText,
    })
    .from(meetingsV2DocumentPages)
    .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2DocumentPages.pageNumber));
  const split = upcomingAgendaSplit(readMeetingV2Settings(meeting.settings));
  const rewrites = await listMeetingPageRewrites(meetingId);
  const selected = selectCorrectedAttachmentPages({
    pages: storedPages,
    rewrites,
    agendaContentEndsAtPage: split,
  });
  const attachmentPages = selected.pages;
  const pagesWithoutText = selected.pagesWithoutText;
  const attachmentPageNumbers = attachmentPageNumbersToLink(selected);

  const correctedByPage = new Map(attachmentPages.map((page) => [page.pageNumber, page.text]));
  const agendaText = new Map(
    rewrites
      .filter((page) => split != null && page.pageNumber <= split)
      .map((page) => [page.pageNumber, page.correctedText]),
  );
  const items = itemRows.map((item) => {
    const sourcePages = readAgendaSourcePages(item.sourcePagesJson);
    const agendaPages = sourcePages.filter((page) => split == null || page <= split);
    return {
      id: item.id,
      itemNumber: item.itemNumber,
      title: item.title,
      sourcePages,
      citationText: [item.summary ?? "", ...agendaPages.map((page) => agendaText.get(page) ?? "")].join("\n"),
    };
  });

  const cited = linkCorrectedAttachmentPages({
    agendaContentEndsAtPage: split,
    items,
    attachmentPageNumbers,
    modelAssignments: [],
  });
  const claimed = new Set<number>();
  for (const pages of cited.pagesByItemId.values()) {
    for (const page of pages) {
      if (split != null && page > split) claimed.add(page);
    }
  }
  const remaining = attachmentPages.filter((page) => !claimed.has(page.pageNumber));
  const modelAssignments: Array<{ agendaItemId: string; pages: number[] }> = [];
  const deepSeekUsage: DeepSeekGenerationResult[] = [];
  if (remaining.length > 0) {
    if (!isDeepSeekKeyConfigured()) {
      throw new AttachmentLinkError(
        "DEEPSEEK_API_KEY is required to link attachment pages that the agenda does not already name.",
        409,
      );
    }
    await setAttachmentStep(meetingId, "Linking attachment pages to agenda topics");
    try {
      for (let offset = 0; offset < remaining.length; offset += 8) {
        const batch = remaining.slice(offset, offset + 8);
        const response = await generateDeepSeekJson({
          systemInstruction: ATTACHMENT_ASSIGNMENT_PROMPT,
          userText: JSON.stringify({
            agendaItems: items.map((item) => ({
              id: item.id,
              itemNumber: item.itemNumber,
              title: item.title,
            })),
            pages: batch.map((page) => ({
              pageNumber: page.pageNumber,
              heading: page.heading,
              text: correctedByPage.get(page.pageNumber)?.slice(0, 1600) ?? "",
            })),
          }),
          modelName: "deepseek-v4-flash",
          temperature: 0,
          thinking: false,
        });
        deepSeekUsage.push(response);
        modelAssignments.push(...readAttachmentAssignments(response.text));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Attachment linking failed.";
      await setAttachmentStep(meetingId, "Attachment linking failed");
      throw new AttachmentLinkError(message, 502);
    }
  }

  const linked = linkCorrectedAttachmentPages({
    agendaContentEndsAtPage: split,
    items,
    attachmentPageNumbers,
    modelAssignments,
  });
  const unassignedPages = linked.unassignedPages;
  const unlinkedBlankPages = pagesWithoutText.filter((page) => unassignedPages.includes(page));
  const completedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const item of items) {
      const pages = linked.pagesByItemId.get(item.id) ?? item.sourcePages;
      await tx
        .update(meetingsV3AgendaItems)
        .set({ sourcePagesJson: JSON.stringify(pages), factsJson: null })
        .where(eq(meetingsV3AgendaItems.id, item.id));
    }
  });
  await writeMeetingsV3AttachmentLink(meetingId, {
    completedAt,
    assignedPageCount: linked.assignedPageCount,
    unassignedPages,
    pagesWithoutText: unlinkedBlankPages,
  });
  await setAttachmentStep(
    meetingId,
    linked.assignedPageCount > 0
      ? "Attachment pages linked to agenda topics"
      : attachmentPages.length === 0 && pagesWithoutText.length > 0
        ? "Attachment pages had no extracted text"
        : linked.unassignedPages.length === 0
          ? "No attachment pages after the agenda split"
          : "Attachment pages linked to agenda topics",
  );

  if (deepSeekUsage.length > 0) {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3DeepSeekStageRow("v3_attachments", deepSeekUsage),
    );
  } else {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3NotApplicableStageRow("v3_attachments", {
        modelName: "N/A",
        usageDetail:
          attachmentPages.length === 0
            ? pagesWithoutText.length > 0
              ? "Attachment pages had no extracted text."
              : "No attachment pages after the agenda split."
            : "Agenda citations linked every attachment page; no model call.",
      }),
    );
  }

  return {
    meetingId,
    assignedPageCount: linked.assignedPageCount,
    unassignedPages,
    pagesWithoutText: unlinkedBlankPages,
    items: await listMeetingV3Agenda(meetingId),
  };
}

async function setAttachmentStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}
