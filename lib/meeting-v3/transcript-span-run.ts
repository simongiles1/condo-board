/**
 * Assigns transcript stretches to a V3 agenda with the V2 walk, edge review, and hole fill.
 * Cues are not merged by speaker. V2 agenda rows and V2 transcript segments are not written.
 */

import { randomUUID } from "crypto";
import { access, readFile } from "fs/promises";
import path from "path";

import { asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetings, meetingsV2, meetingsV3AgendaItems } from "@/lib/db/schema";
import { generateDeepSeekJson, type DeepSeekGenerationResult } from "@/lib/deepseek/client";
import { compareAgendaItemCodes } from "@/lib/meeting-v2/agenda-outline";
import { isDeepSeekKeyConfigured, readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import type { SegmentationJsonFn } from "@/lib/meeting-v2/segment-json";
import type { SpanReviewCue } from "@/lib/meeting-v2/span-edge-review";
import { segmentAgendaTopics } from "@/lib/meeting-v2/transcript-segmentation";
import { listMeetingV3Agenda, type MeetingsV3AgendaItem } from "@/lib/meeting-v3/agenda-run";
import {
  buildMeetingsV3DeepSeekStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import { writeMeetingsV3TranscriptSegmentation } from "@/lib/meeting-v3/package-status";
import {
  cuesFromVtt,
  packageAgendaItems,
  rowsFromSegmentedTopics,
  type MeetingsV3TranscriptCue,
  type SegmentedTopicSpanRow,
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

/**
 * Replaces transcript spans on the V3 agenda.
 * Talk that is not on the printed agenda is stored as the additional-business rows the V2 walk creates.
 * A previous extra under 4.E is dropped first so a re-run cannot double those leaves.
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
      sourcePagesJson: meetingsV3AgendaItems.sourcePagesJson,
      summary: meetingsV3AgendaItems.summary,
    })
    .from(meetingsV3AgendaItems)
    .where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3AgendaItems.sortOrder));
  const seedRows = packageAgendaItems(storedRows);
  if (seedRows.length === 0) {
    throw new TranscriptSpanError("Build the agenda before segmenting the transcript.", 409);
  }

  const cues = await loadMeetingCues(meetingId);
  if (!isDeepSeekKeyConfigured()) {
    throw new TranscriptSpanError("DEEPSEEK_API_KEY is required to segment the transcript.", 409);
  }

  const deepSeekUsage: DeepSeekGenerationResult[] = [];
  await setTranscriptStep(meetingId, "Segmenting the transcript");
  let segmented: SegmentedTopicSpanRow[];
  try {
    const topics = await segmentAgendaTopics({
      meetingId,
      items: seedRows.map((item) => ({
        title: item.title,
        sectionLabel: item.sectionLabel,
        itemType: item.itemType,
        itemNumber: item.itemNumber,
        sourcePagesJson: item.sourcePagesJson,
        sourceText: item.summary,
      })),
      cues: reviewCuesFromTranscript(cues),
      generate: meteringGenerate(deepSeekUsage),
      onProgress: (label) => setTranscriptStep(meetingId, label),
    });
    segmented = rowsFromSegmentedTopics({ topics, cues });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcript segmentation failed.";
    await setTranscriptStep(meetingId, "Transcript segmentation failed");
    throw new TranscriptSpanError(message, 502);
  }

  const storedByNumber = new Map(seedRows.map((item) => [item.itemNumber.trim().toLowerCase(), item]));
  const ordered = [...segmented].sort((left, right) => compareAgendaItemCodes(left.itemNumber, right.itemNumber));
  const knownNumbers = new Set(ordered.map((row) => row.itemNumber.trim().toLowerCase()));
  const untouched = seedRows.filter((item) => !knownNumbers.has(item.itemNumber.trim().toLowerCase()));
  const extraIds = storedRows
    .filter((item) => !seedRows.some((row) => row.id === item.id))
    .map((item) => item.id);
  let spanCount = 0;
  let overlapItemCount = 0;
  for (const row of ordered) {
    spanCount += row.transcript.spans.length;
    if (row.transcript.spans.some((span) => span.overlaps)) overlapItemCount += 1;
  }

  const completedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    if (extraIds.length > 0) {
      await tx.delete(meetingsV3AgendaItems).where(inArray(meetingsV3AgendaItems.id, extraIds));
    }
    let index = 0;
    for (const row of ordered) {
      const existing = storedByNumber.get(row.itemNumber.trim().toLowerCase());
      const transcriptSpansJson = JSON.stringify(row.transcript);
      if (existing) {
        await tx
          .update(meetingsV3AgendaItems)
          .set({ transcriptSpansJson, sortOrder: index })
          .where(eq(meetingsV3AgendaItems.id, existing.id));
      } else {
        await tx.insert(meetingsV3AgendaItems).values({
          id: randomUUID(),
          meetingV2Id: meetingId,
          sortOrder: index,
          itemNumber: row.itemNumber,
          title: row.title,
          sectionLabel: row.sectionLabel,
          itemType: row.itemType,
          sourcePagesJson: "[]",
          summary: null,
          amount: null,
          vendorsJson: null,
          recommendation: null,
          factsJson: null,
          factGroupsJson: null,
          transcriptSpansJson,
          createdAt: completedAt,
        });
      }
      index += 1;
    }
    for (const item of untouched) {
      await tx
        .update(meetingsV3AgendaItems)
        .set({
          transcriptSpansJson: JSON.stringify({ spans: [] }),
          sortOrder: index,
        })
        .where(eq(meetingsV3AgendaItems.id, item.id));
      index += 1;
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
        ? "Transcript spans stored"
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

function reviewCuesFromTranscript(cues: readonly MeetingsV3TranscriptCue[]): SpanReviewCue[] {
  return cues.map((cue, sequence) => ({
    sequence,
    startSeconds: cue.startMs / 1000,
    endSeconds: cue.endMs / 1000,
    startTimestamp: clockFromMs(cue.startMs),
    speaker: cue.speaker,
    text: cue.text,
  }));
}

function clockFromMs(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function meteringGenerate(usage: DeepSeekGenerationResult[]): SegmentationJsonFn {
  return async (options) => {
    const result = await generateDeepSeekJson({
      systemInstruction: options.systemInstruction,
      userText: options.userText,
      modelName: "deepseek-v4-flash",
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      thinking: false,
      allowTruncated: options.allowTruncated,
    });
    usage.push(result);
    return {
      text: result.text,
      modelName: result.modelName,
      usage: result.usage,
      finishReason: result.finishReason,
    };
  };
}

async function setTranscriptStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}
