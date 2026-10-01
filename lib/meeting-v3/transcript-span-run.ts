/**
 * Assigns transcript stretches to a V3 agenda.
 * V2 transcript segments are not written.
 */

import { randomUUID } from "crypto";
import { access, readFile } from "fs/promises";
import path from "path";

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetings, meetingsV2, meetingsV3AgendaItems } from "@/lib/db/schema";
import { generateDeepSeekJson, type DeepSeekGenerationResult } from "@/lib/deepseek/client";
import { isDeepSeekKeyConfigured, readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { listMeetingV3Agenda, type MeetingsV3AgendaItem } from "@/lib/meeting-v3/agenda-run";
import {
  buildMeetingsV3DeepSeekStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import { writeMeetingsV3TranscriptSegmentation } from "@/lib/meeting-v3/package-status";
import {
  acceptQuotedSpans,
  ADDITIONAL_BUSINESS_TITLE,
  chunkTranscriptCues,
  cuesFromVtt,
  planAdditionalBusinessItem,
  readProposedSpans,
  TRANSCRIPT_SEGMENT_MAX_OUTPUT_TOKENS,
  type MeetingsV3ItemTranscript,
  type MeetingsV3ProposedSpan,
  type MeetingsV3TranscriptCue,
} from "@/lib/meeting-v3/transcript-spans";
import { isMeetingsV3Workspace, meetingsV3FactResolution } from "@/lib/meeting-v3/workspace";

/** A segmentation the route can return with an HTTP status. */
export class TranscriptSpanError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TranscriptSpanError";
    this.status = status;
  }
}

/** The spans stored for one meeting. */
export type TranscriptSpanResult = {
  meetingId: string;
  spanCount: number;
  overlapItemCount: number;
  items: MeetingsV3AgendaItem[];
};

function transcriptSpanPrompt(additionalBusinessCode: string): string {
  return `You assign stretches of a condominium board meeting transcript to agenda items.
Return JSON only: {"items":[{"agendaItemId":"<id>","spans":[{"startMs":0,"endMs":2000,"quote":"<verbatim words from one cue inside that stretch>"}]}]}.
Rules:
- Use only agendaItemId values from the input, and only startMs and endMs values copied from the cues.
- A span starts at a cue's startMs and ends at a cue's endMs. It may cover several cues in a row.
- quote is copied from one cue inside that span.
- One stretch belongs to one item. If the same item is discussed again later, add another span. Do not cover the talk in between.
- Assent and "any other questions" stay with the item being closed. They do not open the next item.
- Talk that is not one of the other agenda items is additional business. Assign those stretches to the item whose itemNumber is ${additionalBusinessCode}. Do not attach that talk to the previous item, the next meeting date, or adjournment.
- Omit an item that is not discussed in these cues.`;
}

/**
 * Replaces transcript spans on the V3 agenda.
 * Talk that is not on the printed agenda is stored as additional business on the property-management E slot (4.E when that report is item 4).
 * A quote that is not inside the named cue window is dropped.
 * Throws TranscriptSpanError when the meeting, facts, or transcript are not ready.
 * A model failure leaves the previous spans in place.
 */
export async function segmentMeetingV3Transcript(meetingId: string): Promise<TranscriptSpanResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(meeting?.settings);
  if (!meeting || !isMeetingsV3Workspace(settings)) {
    throw new TranscriptSpanError("Meeting not found.", 404);
  }
  if (!meetingsV3FactResolution(settings)) {
    throw new TranscriptSpanError("Resolve facts before segmenting the transcript.", 409);
  }

  const storedRows = await db
    .select({
      id: meetingsV3AgendaItems.id,
      sortOrder: meetingsV3AgendaItems.sortOrder,
      itemNumber: meetingsV3AgendaItems.itemNumber,
      title: meetingsV3AgendaItems.title,
      sectionLabel: meetingsV3AgendaItems.sectionLabel,
      itemType: meetingsV3AgendaItems.itemType,
    })
    .from(meetingsV3AgendaItems)
    .where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3AgendaItems.sortOrder));
  if (storedRows.length === 0) {
    throw new TranscriptSpanError("Build the agenda before segmenting the transcript.", 409);
  }
  const plan = planAdditionalBusinessItem(storedRows, (code) => ({
    id: randomUUID(),
    sortOrder: storedRows.length,
    itemNumber: code,
    title: ADDITIONAL_BUSINESS_TITLE,
    sectionLabel: additionalBusinessSectionLabel(storedRows, code),
    itemType: "ad_hoc_discussion",
  }));
  const itemRows = plan.items;

  const cues = await loadMeetingCues(meetingId);
  if (!isDeepSeekKeyConfigured()) {
    throw new TranscriptSpanError("DEEPSEEK_API_KEY is required to segment the transcript.", 409);
  }

  const agendaItemIds = new Set(itemRows.map((item) => item.id));
  const proposed: MeetingsV3ProposedSpan[] = [];
  const deepSeekUsage: DeepSeekGenerationResult[] = [];
  await setTranscriptStep(meetingId, "Segmenting the transcript");
  try {
    for (const batch of chunkTranscriptCues(cues)) {
      const spans = await requestSpanBatch(itemRows, plan.code, batch, deepSeekUsage);
      proposed.push(...spans);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcript segmentation failed.";
    await setTranscriptStep(meetingId, "Transcript segmentation failed");
    throw new TranscriptSpanError(message, 502);
  }

  const accepted = acceptQuotedSpans({ cues, proposed, agendaItemIds });
  const keepInjected = plan.injected != null && (accepted.get(plan.injected.id)?.spans.length ?? 0) > 0;
  const savedRows = keepInjected || plan.injected == null
    ? itemRows
    : itemRows.filter((item) => item.id !== plan.injected?.id);
  const byItem = new Map<string, MeetingsV3ItemTranscript>();
  let spanCount = 0;
  let overlapItemCount = 0;
  for (const item of savedRows) {
    const transcript = accepted.get(item.id) ?? { spans: [] };
    byItem.set(item.id, transcript);
    spanCount += transcript.spans.length;
    if (transcript.spans.some((span) => span.overlaps)) overlapItemCount += 1;
  }

  const completedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    if (keepInjected && plan.injected) {
      await tx.insert(meetingsV3AgendaItems).values({
        id: plan.injected.id,
        meetingV2Id: meetingId,
        sortOrder: plan.injected.sortOrder,
        itemNumber: plan.injected.itemNumber,
        title: plan.injected.title,
        sectionLabel: plan.injected.sectionLabel,
        itemType: plan.injected.itemType,
        sourcePagesJson: "[]",
        summary: null,
        amount: null,
        vendorsJson: null,
        recommendation: null,
        factsJson: null,
        factGroupsJson: null,
        transcriptSpansJson: JSON.stringify(byItem.get(plan.injected.id)),
        createdAt: completedAt,
      });
    }
    for (const [index, item] of savedRows.entries()) {
      if (plan.injected && item.id === plan.injected.id) {
        if (item.sortOrder !== index) {
          await tx
            .update(meetingsV3AgendaItems)
            .set({ sortOrder: index })
            .where(eq(meetingsV3AgendaItems.id, item.id));
        }
        continue;
      }
      await tx
        .update(meetingsV3AgendaItems)
        .set({
          transcriptSpansJson: JSON.stringify(byItem.get(item.id)),
          sortOrder: index,
          itemNumber: item.itemNumber,
        })
        .where(eq(meetingsV3AgendaItems.id, item.id));
    }
  });
  await writeMeetingsV3TranscriptSegmentation(meetingId, {
    completedAt,
    spanCount,
    overlapItemCount,
  });
  await setTranscriptStep(
    meetingId,
    overlapItemCount > 0
      ? "Transcript spans stored; some topics share a stretch"
      : spanCount > 0
        ? "Transcript spans stored from the cues"
        : "No transcript span matched the agenda",
  );
  await persistMeetingsV3AiUsageStage(
    meetingId,
    buildMeetingsV3DeepSeekStageRow("v3_transcript", deepSeekUsage),
  );

  return {
    meetingId,
    spanCount,
    overlapItemCount,
    items: await listMeetingV3Agenda(meetingId),
  };
}

async function loadMeetingCues(meetingId: string): Promise<MeetingsV3TranscriptCue[]> {
  const db = getDb();
  const [legacy] = await db
    .select({ vttFilePath: meetings.vttFilePath })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  const relative = legacy?.vttFilePath?.trim() ?? "";
  if (!relative) {
    throw new TranscriptSpanError("This meeting has no transcript.", 409);
  }
  const absolute = path.resolve(process.cwd(), relative);
  try {
    await access(absolute);
  } catch {
    throw new TranscriptSpanError("The transcript file is missing.", 409);
  }
  const cues = cuesFromVtt(await readFile(absolute, "utf8"));
  if (cues.length === 0) {
    throw new TranscriptSpanError("The transcript has no cues.", 409);
  }
  return cues;
}

function additionalBusinessSectionLabel(
  items: Array<{ itemNumber: string; title: string }>,
  code: string,
): string {
  const parentNumber = code.split(".")[0] ?? "";
  const parent = items.find((item) => item.itemNumber.trim() === parentNumber);
  return parent ? `${parent.title}: ${ADDITIONAL_BUSINESS_TITLE}` : ADDITIONAL_BUSINESS_TITLE;
}

async function requestSpanBatch(
  items: Array<{ id: string; itemNumber: string; title: string }>,
  additionalBusinessCode: string,
  cues: MeetingsV3TranscriptCue[],
  deepSeekUsage: DeepSeekGenerationResult[],
): Promise<MeetingsV3ProposedSpan[]> {
  if (cues.length === 0) return [];
  try {
    const response = await generateDeepSeekJson({
      systemInstruction: transcriptSpanPrompt(additionalBusinessCode),
      userText: JSON.stringify({
        items: items.map((item) => ({
          agendaItemId: item.id,
          itemNumber: item.itemNumber,
          title: item.title,
        })),
        cues: cues.map((cue) => ({
          startMs: cue.startMs,
          endMs: cue.endMs,
          speaker: cue.speaker,
          text: cue.text,
        })),
      }),
      modelName: "deepseek-v4-flash",
      temperature: 0,
      thinking: false,
      maxOutputTokens: TRANSCRIPT_SEGMENT_MAX_OUTPUT_TOKENS,
    });
    deepSeekUsage.push(response);
    return readProposedSpans(response.text).flatMap((entry) =>
      entry.spans.map((span) => ({ ...span, agendaItemId: entry.agendaItemId })),
    );
  } catch (error) {
    if (!isTruncatedDeepSeekOutput(error) || cues.length < 2) throw error;
    const mid = Math.ceil(cues.length / 2);
    const left = await requestSpanBatch(items, additionalBusinessCode, cues.slice(0, mid), deepSeekUsage);
    const right = await requestSpanBatch(items, additionalBusinessCode, cues.slice(mid), deepSeekUsage);
    return [...left, ...right];
  }
}

function isTruncatedDeepSeekOutput(error: unknown): boolean {
  return error instanceof Error && error.message.includes("finish_reason=length");
}

async function setTranscriptStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}
