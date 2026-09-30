/**
 * Builds a V3 agenda from corrected package pages.
 * V2 agenda rows and the stored Docling extract are not written.
 */

import { randomUUID } from "crypto";

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2DocumentPages, meetingsV3AgendaItems } from "@/lib/db/schema-v2";
import {
  extractBoardPackageAgendaJson,
  flattenBoardPackageAgenda,
} from "@/lib/meeting-v2/board-package-agenda";
import { readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { upcomingAgendaSplit } from "@/lib/meeting-v2/upcoming-meeting";
import {
  readAgendaSourcePages,
  readAgendaVendors,
  selectCorrectedAgendaPages,
} from "@/lib/meeting-v3/agenda-pages";
import { listMeetingPageRewrites } from "@/lib/meeting-v3/page-rewrite-run";
import { meetingsV3SettingsWithAttachmentLink } from "@/lib/meeting-v3/package-status";
import type { DeepSeekGenerationResult } from "@/lib/deepseek/client";
import {
  buildMeetingsV3DeepSeekStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import { isMeetingsV3Workspace } from "@/lib/meeting-v3/workspace";

/** An agenda build the route can return with an HTTP status. */
export class AgendaExtractError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgendaExtractError";
    this.status = status;
  }
}

/** One agenda topic stored for a V3 meeting. */
export type MeetingsV3AgendaItem = {
  itemNumber: string;
  title: string;
  sectionLabel: string;
  itemType: string;
  sourcePages: number[];
  summary: string | null;
  amount: string | null;
  vendors: string[];
  recommendation: string | null;
};

/** The agenda stored for one meeting after a build. */
export type AgendaBuildResult = {
  meetingId: string;
  itemCount: number;
  items: MeetingsV3AgendaItem[];
};

/**
 * Replaces the meeting's V3 agenda with topics read from the corrected pages.
 * Throws AgendaExtractError when the meeting is missing, pages are uncorrected, or the model reply fails.
 * A failure leaves the previous agenda in place.
 */
export async function buildMeetingV3Agenda(meetingId: string): Promise<AgendaBuildResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  if (!meeting || !isMeetingsV3Workspace(readMeetingV2Settings(meeting.settings))) {
    throw new AgendaExtractError("Meeting not found.", 404);
  }

  const storedPages = await db
    .select({
      pageNumber: meetingsV2DocumentPages.pageNumber,
      heading: meetingsV2DocumentPages.pageHeading,
    })
    .from(meetingsV2DocumentPages)
    .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2DocumentPages.pageNumber));
  if (storedPages.length === 0) {
    throw new AgendaExtractError("No extracted board-package pages for this meeting.", 409);
  }

  const settings = readMeetingV2Settings(meeting.settings);
  const split = upcomingAgendaSplit(settings);
  let pages;
  try {
    pages = selectCorrectedAgendaPages({
      pages: storedPages,
      rewrites: await listMeetingPageRewrites(meetingId),
      agendaContentEndsAtPage: split,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Corrected pages are not ready.";
    throw new AgendaExtractError(message, 409);
  }

  await setAgendaStep(meetingId, "Building the agenda from corrected pages");
  const deepSeekUsage: DeepSeekGenerationResult[] = [];
  let agenda;
  try {
    agenda = await extractBoardPackageAgendaJson({
      meetingId,
      agendaContentEndsAtPage: split ?? undefined,
      pages,
      onProgress: async (progress) => {
        await setAgendaStep(meetingId, progress.label);
      },
      onDeepSeekUsage: (result) => {
        deepSeekUsage.push(result);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agenda extraction failed.";
    await setAgendaStep(meetingId, "Agenda extraction failed");
    throw new AgendaExtractError(message, 502);
  }

  const topics = flattenBoardPackageAgenda(agenda);
  const createdAt = new Date().toISOString();
  const rows = topics.map((topic, index) => ({
    id: randomUUID(),
    meetingV2Id: meetingId,
    sortOrder: index,
    itemNumber: topic.itemNumber,
    title: topic.title,
    sectionLabel: topic.sectionLabel,
    itemType: topic.itemType,
    sourcePagesJson: JSON.stringify(topic.sourcePages),
    summary: textOrNull(topic.summary),
    amount: textOrNull(topic.financials?.amount),
    vendorsJson: vendorNames(topic.contractorsOrVendors),
    recommendation: textOrNull(topic.managementRecommendation),
    createdAt,
  }));

  await db.transaction(async (tx) => {
    await tx.delete(meetingsV3AgendaItems).where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId));
    if (rows.length > 0) {
      await tx.insert(meetingsV3AgendaItems).values(rows);
    }
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
  await setAgendaStep(meetingId, "Agenda built from corrected pages");

  if (deepSeekUsage.length > 0) {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3DeepSeekStageRow("v3_agenda", deepSeekUsage),
    );
  }

  return {
    meetingId,
    itemCount: rows.length,
    items: rows.map(toAgendaItem),
  };
}

/**
 * The V3 agenda stored for a meeting, in outline order.
 */
export async function listMeetingV3Agenda(meetingId: string): Promise<MeetingsV3AgendaItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      itemNumber: meetingsV3AgendaItems.itemNumber,
      title: meetingsV3AgendaItems.title,
      sectionLabel: meetingsV3AgendaItems.sectionLabel,
      itemType: meetingsV3AgendaItems.itemType,
      sourcePagesJson: meetingsV3AgendaItems.sourcePagesJson,
      summary: meetingsV3AgendaItems.summary,
      amount: meetingsV3AgendaItems.amount,
      vendorsJson: meetingsV3AgendaItems.vendorsJson,
      recommendation: meetingsV3AgendaItems.recommendation,
    })
    .from(meetingsV3AgendaItems)
    .where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3AgendaItems.sortOrder));
  return rows.map(toAgendaItem);
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function vendorNames(values: unknown): string | null {
  if (!Array.isArray(values)) return null;
  const names = values.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  return names.length > 0 ? JSON.stringify(names) : null;
}

function toAgendaItem(row: {
  itemNumber: string;
  title: string;
  sectionLabel: string;
  itemType: string;
  sourcePagesJson: string;
  summary: string | null;
  amount: string | null;
  vendorsJson: string | null;
  recommendation: string | null;
}): MeetingsV3AgendaItem {
  return {
    itemNumber: row.itemNumber,
    title: row.title,
    sectionLabel: row.sectionLabel,
    itemType: row.itemType,
    sourcePages: readAgendaSourcePages(row.sourcePagesJson),
    summary: row.summary,
    amount: row.amount,
    vendors: readAgendaVendors(row.vendorsJson),
    recommendation: row.recommendation,
  };
}

async function setAgendaStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}
