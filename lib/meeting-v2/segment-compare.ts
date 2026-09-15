import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2AgendaItems,
  meetingsV2DocumentChunks,
  meetingsV2TranscriptSegments,
} from "@/lib/db/schema";
import { applyAgendaHierarchyCorrections } from "@/lib/meeting-v2/agenda-outline";
import {
  TRANSCRIPT_SYSTEM_PROMPT,
  applyAdHocOutlinePlacement,
  buildTranscriptUserText,
  completeAgendaChunk,
  isNoChangeResponse,
  normalizeWorkflowState,
  parseWithRepair,
  sortTopics,
  type WorkflowState,
  type WorkflowTopic,
} from "@/lib/meeting-v2/agenda-ai";
import type { MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import {
  assignRemainingHolesToAgenda,
  assignUnmatchedLeavesInHoles,
  createGapHoleJudge,
  extendFloorThroughLifecycleHoles,
} from "@/lib/meeting-v2/gap-leaf-assignment";
import {
  estimateSegmentCompareCostUsd,
  formatSegmentCompareChoice,
  segmentCompareModel,
  type SegmentCompareRun,
  type SegmentCompareSlotChoice,
  type SegmentCompareUsage,
} from "@/lib/meeting-v2/segment-compare-models";
import { createSegmentationJsonFn, type SegmentationJsonFn } from "@/lib/meeting-v2/segment-json";
import {
  createSpanEdgeJudge,
  reviewTranscriptTopicSpans,
  transcriptSegmentsToReviewCues,
} from "@/lib/meeting-v2/span-edge-review";
import type { MergedVttCue } from "@/lib/parsers/vtt";
import {
  buildTranscriptSectionOverlays,
  discussionTimingFromSourceText,
  type TranscriptSectionOverlay,
} from "@/lib/transcript/section-overlay";
import type { TokenUsage } from "@/lib/gemini/usage";

const MAX_STORED_RUNS = 20;

type MeteredUsage = TokenUsage & { billedAtMs: number };

function emptyMeter(): MeteredUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    billedAtMs: Date.now(),
  };
}

function addUsage(meter: MeteredUsage, usage: TokenUsage): void {
  meter.inputTokens += usage.inputTokens;
  meter.outputTokens += usage.outputTokens;
  meter.totalTokens += usage.totalTokens;
  meter.cacheHitTokens = (meter.cacheHitTokens ?? 0) + (usage.cacheHitTokens ?? 0);
  meter.cacheMissTokens = (meter.cacheMissTokens ?? 0) + (usage.cacheMissTokens ?? 0);
}

function meterJson(generate: SegmentationJsonFn, meter: MeteredUsage): SegmentationJsonFn {
  return async (options) => {
    const result = await generate(options);
    addUsage(meter, result.usage);
    return result;
  };
}

function usageFromMeter(
  choice: SegmentCompareSlotChoice,
  meter: MeteredUsage,
): SegmentCompareUsage {
  const catalog = segmentCompareModel(choice.modelId);
  return {
    modelId: choice.modelId,
    apiModel: catalog.apiModel,
    thinking: choice.thinking,
    inputTokens: meter.inputTokens,
    outputTokens: meter.outputTokens,
    totalTokens: meter.totalTokens,
    cacheHitTokens: meter.cacheHitTokens,
    cacheMissTokens: meter.cacheMissTokens,
    costUsd: estimateSegmentCompareCostUsd(catalog.apiModel, meter, meter.billedAtMs),
  };
}

function safeParseObject<T>(value: string | null | undefined): T | null {
  if (!value?.trim()) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stripSeededTiming(sourceText: string | null): string | null {
  if (!sourceText) return null;
  return sourceText
    .split("\n")
    .filter((line) => !/^\s*(discussion status|discussion timing):/i.test(line))
    .join("\n")
    .trim() || null;
}

function seedStateFromAgendaItems(
  items: Array<{
    title: string;
    sectionLabel: string | null;
    itemType: string;
    itemNumber: string | null;
    sourcePagesJson: string;
    sourceText: string | null;
  }>,
): WorkflowState {
  return {
    documentTopics: items.map((item) => {
      const pages = safeParseObject<number[]>(item.sourcePagesJson) ?? [];
      return {
        title: item.title,
        sectionLabel: item.sectionLabel?.trim() || "Unknown",
        itemType: item.itemType,
        itemNumber: item.itemNumber?.trim() || undefined,
        visibility: "PUBLIC",
        sourcePages: pages,
        sourceChunkIds: [],
        sourceTranscriptRanges: [],
        discussionStatus: "not_discussed",
        discussionTimestampRange: null,
        consolidationReason: null,
        sourceText: stripSeededTiming(item.sourceText),
        aliases: [],
        notes: [],
        confidence: 1,
        confidenceReason: "Seeded from stored agenda outline",
        evidenceStrength: "DIRECT",
        openQuestions: [],
        needsHumanReview: false,
        humanReviewReason: null,
      } satisfies WorkflowTopic;
    }),
    extraTopics: [],
    uncertainties: [],
  };
}

export function overlaysFromTopics(topics: WorkflowTopic[]): TranscriptSectionOverlay[] {
  const items = topics.map((topic, index) => ({
    id: `segment-exp-${index}`,
    title: topic.title,
    itemNumber: topic.itemNumber ?? null,
    discussionTiming: topic.discussionTimestampRange ?? null,
  }));
  return buildTranscriptSectionOverlays(items, (item) => item.discussionTiming);
}

export function overlaysFromSavedAgenda(
  items: Array<{
    id: string;
    title: string;
    itemNumber: string | null;
    sourceText?: string | null;
  }>,
): TranscriptSectionOverlay[] {
  return buildTranscriptSectionOverlays(items, (item) =>
    discussionTimingFromSourceText(item.sourceText),
  );
}

export function transcriptSegmentsToCues(
  segments: Array<{
    startTimestamp: string;
    endTimestamp: string;
    speakerLabel: string | null;
    text: string;
  }>,
): MergedVttCue[] {
  return segments.map((segment) => ({
    start: segment.startTimestamp,
    end: segment.endTimestamp,
    speaker: segment.speakerLabel ?? "",
    text: segment.text,
  }));
}

async function loadMeetingSettings(meetingId: string): Promise<{
  settings: MeetingV2Settings;
  updatedAt: string;
}> {
  const db = getDb();
  const [meeting] = await db
    .select({ settings: meetingsV2.settings, updatedAt: meetingsV2.updatedAt })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  if (!meeting) {
    throw new Error(`V2 meeting ${meetingId} was not found.`);
  }
  return {
    settings: (meeting.settings as MeetingV2Settings) || {},
    updatedAt: meeting.updatedAt,
  };
}

async function writeRuns(meetingId: string, runs: SegmentCompareRun[]): Promise<void> {
  const { settings } = await loadMeetingSettings(meetingId);
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({
      settings: { ...settings, segmentCompareRuns: runs },
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingsV2.id, meetingId));
}

export async function listSegmentCompareRuns(meetingId: string): Promise<SegmentCompareRun[]> {
  const { settings } = await loadMeetingSettings(meetingId);
  return settings.segmentCompareRuns ?? [];
}

export async function patchSegmentCompareRun(
  meetingId: string,
  runId: string,
  patch: Partial<SegmentCompareRun>,
): Promise<SegmentCompareRun | null> {
  const runs = await listSegmentCompareRuns(meetingId);
  let next: SegmentCompareRun | null = null;
  const updated = runs.map((run) => {
    if (run.id !== runId) return run;
    next = { ...run, ...patch };
    return next;
  });
  if (!next) return null;
  await writeRuns(meetingId, updated);
  return next;
}

export async function deleteSegmentCompareRun(meetingId: string, runId: string): Promise<void> {
  const runs = await listSegmentCompareRuns(meetingId);
  await writeRuns(
    meetingId,
    runs.filter((run) => run.id !== runId),
  );
}

export async function queueSegmentCompareRun(options: {
  meetingId: string;
  walk: SegmentCompareSlotChoice;
  edge: SegmentCompareSlotChoice;
}): Promise<SegmentCompareRun> {
  const runs = await listSegmentCompareRuns(options.meetingId);
  if (runs.some((run) => run.status === "queued" || run.status === "running")) {
    throw new Error("A segment compare run is already in progress for this meeting.");
  }
  const run: SegmentCompareRun = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    completedAt: null,
    status: "queued",
    progressLabel: "Queued",
    error: null,
    walk: options.walk,
    edge: options.edge,
    overlays: [],
    walkUsage: null,
    edgeUsage: null,
    totalCostUsd: null,
  };
  const kept = [...runs, run].slice(-MAX_STORED_RUNS);
  await writeRuns(options.meetingId, kept);
  return run;
}

export async function loadSegmentCompareWorkspace(meetingId: string): Promise<{
  cues: MergedVttCue[];
  savedOverlays: TranscriptSectionOverlay[];
  runs: SegmentCompareRun[];
  agendaItemCount: number;
}> {
  const db = getDb();
  const [segments, agendaItems, runs] = await Promise.all([
    db
      .select({
        startTimestamp: meetingsV2TranscriptSegments.startTimestamp,
        endTimestamp: meetingsV2TranscriptSegments.endTimestamp,
        speakerLabel: meetingsV2TranscriptSegments.speakerLabel,
        text: meetingsV2TranscriptSegments.text,
      })
      .from(meetingsV2TranscriptSegments)
      .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2TranscriptSegments.sequence)),
    db
      .select({
        id: meetingsV2AgendaItems.id,
        title: meetingsV2AgendaItems.title,
        itemNumber: meetingsV2AgendaItems.itemNumber,
        sourceText: meetingsV2AgendaItems.sourceText,
      })
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2AgendaItems.sortOrder)),
    listSegmentCompareRuns(meetingId),
  ]);
  return {
    cues: transcriptSegmentsToCues(segments),
    savedOverlays: overlaysFromSavedAgenda(agendaItems),
    runs,
    agendaItemCount: agendaItems.length,
  };
}

export async function runSegmentCompareExperiment(options: {
  meetingId: string;
  runId: string;
}): Promise<SegmentCompareRun> {
  const { meetingId, runId } = options;
  const existing = (await listSegmentCompareRuns(meetingId)).find((run) => run.id === runId);
  if (!existing) {
    throw new Error(`Segment compare run ${runId} was not found.`);
  }

  const progress = async (label: string) => {
    await patchSegmentCompareRun(meetingId, runId, {
      status: "running",
      progressLabel: label,
    });
  };

  try {
    await progress("Loading stored agenda outline");
    const db = getDb();
    const [agendaItems, storedChunks, transcriptSegments] = await Promise.all([
      db
        .select()
        .from(meetingsV2AgendaItems)
        .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
        .orderBy(asc(meetingsV2AgendaItems.sortOrder)),
      db
        .select()
        .from(meetingsV2DocumentChunks)
        .where(
          and(
            eq(meetingsV2DocumentChunks.meetingV2Id, meetingId),
            eq(meetingsV2DocumentChunks.chunkKind, "transcript"),
          ),
        )
        .orderBy(asc(meetingsV2DocumentChunks.sortOrder)),
      db
        .select({
          sequence: meetingsV2TranscriptSegments.sequence,
          startMs: meetingsV2TranscriptSegments.startMs,
          endMs: meetingsV2TranscriptSegments.endMs,
          startTimestamp: meetingsV2TranscriptSegments.startTimestamp,
          endTimestamp: meetingsV2TranscriptSegments.endTimestamp,
          speakerLabel: meetingsV2TranscriptSegments.speakerLabel,
          text: meetingsV2TranscriptSegments.text,
        })
        .from(meetingsV2TranscriptSegments)
        .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
        .orderBy(asc(meetingsV2TranscriptSegments.sequence)),
    ]);

    if (agendaItems.length === 0) {
      throw new Error("Extract the agenda before comparing segmenters.");
    }
    if (storedChunks.length === 0) {
      throw new Error("No stored transcript chunks found for this meeting.");
    }
    if (transcriptSegments.length === 0) {
      throw new Error("No transcript segments found for this meeting.");
    }

    const walkMeter = emptyMeter();
    const edgeMeter = emptyMeter();
    const walkGenerate = meterJson(createSegmentationJsonFn(existing.walk), walkMeter);
    const edgeGenerate = meterJson(createSegmentationJsonFn(existing.edge), edgeMeter);

    let state = seedStateFromAgendaItems(agendaItems);
    const transcriptChunks = storedChunks.map((chunk, transcriptIndex) => {
      const metadata = safeParseObject<{ aiChunkId?: string; sequenceRange?: [number, number] }>(
        chunk.metadataJson,
      );
      return {
        id: chunk.id,
        aiChunkId:
          metadata?.aiChunkId ?? `transcript_chunk_${String(transcriptIndex + 1).padStart(3, "0")}`,
        transcriptIndex,
        sequenceRange: metadata?.sequenceRange ?? [chunk.sequenceStart ?? 0, chunk.sequenceEnd ?? 0],
        text: chunk.text,
      };
    });

    for (const chunk of transcriptChunks) {
      await progress(
        `Walk ${formatSegmentCompareChoice(existing.walk)} · chunk ${chunk.transcriptIndex + 1}/${transcriptChunks.length}`,
      );
      const response = await completeAgendaChunk({
        systemInstruction: TRANSCRIPT_SYSTEM_PROMPT,
        userText: buildTranscriptUserText({
          meetingId,
          state,
          chunkIndex: chunk.transcriptIndex,
          chunkTotal: transcriptChunks.length,
          chunkId: chunk.aiChunkId,
          sequenceRange: chunk.sequenceRange,
          chunkText: chunk.text,
        }),
        generate: walkGenerate,
      });
      const parsed = await parseWithRepair(response.text, walkGenerate);
      if (!isNoChangeResponse(parsed)) {
        const nextState = normalizeWorkflowState(parsed, state);
        state = {
          documentTopics: nextState.documentTopics,
          extraTopics: nextState.extraTopics,
          uncertainties: nextState.uncertainties,
          discrepancies: nextState.discrepancies,
        };
      }
    }

    const placed = applyAdHocOutlinePlacement(state);
    let finalTopics = applyAgendaHierarchyCorrections(
      sortTopics([...placed.documentTopics, ...placed.extraTopics]).map((topic, index) => ({
        ...topic,
        itemNumber: topic.itemNumber || String(index + 1),
      })),
    );

    const cues = transcriptSegmentsToReviewCues(transcriptSegments);
    const edgeJudge = createSpanEdgeJudge(edgeGenerate);
    const outlineGapJudge = createGapHoleJudge(edgeGenerate, "outline");
    const remainingGapJudge = createGapHoleJudge(edgeGenerate, "remaining");

    await progress(`Edge ${formatSegmentCompareChoice(existing.edge)} · span review`);
    const reviewed = await reviewTranscriptTopicSpans({
      topics: finalTopics,
      cues,
      judge: edgeJudge,
      onProgress: progress,
    });
    const gapped = await assignUnmatchedLeavesInHoles({
      topics: reviewed,
      cues,
      judge: outlineGapJudge,
      onProgress: progress,
    });
    const leftover = await assignRemainingHolesToAgenda({
      topics: gapped,
      cues,
      judge: remainingGapJudge,
      onProgress: progress,
    });
    const wrapped = extendFloorThroughLifecycleHoles({
      topics: leftover,
      cues,
    });
    finalTopics = finalTopics.map((topic, index) => ({
      ...topic,
      discussionTimestampRange:
        wrapped[index]?.discussionTimestampRange ?? topic.discussionTimestampRange,
      sourceTranscriptRanges:
        wrapped[index]?.sourceTranscriptRanges ?? topic.sourceTranscriptRanges,
      discussionStatus: wrapped[index]?.discussionStatus ?? topic.discussionStatus,
    }));
    finalTopics = applyAgendaHierarchyCorrections(finalTopics);

    const walkUsage = usageFromMeter(existing.walk, walkMeter);
    const edgeUsage = usageFromMeter(existing.edge, edgeMeter);
    const completed = await patchSegmentCompareRun(meetingId, runId, {
      status: "completed",
      progressLabel: "Done",
      completedAt: new Date().toISOString(),
      overlays: overlaysFromTopics(finalTopics),
      walkUsage,
      edgeUsage,
      totalCostUsd: walkUsage.costUsd + edgeUsage.costUsd,
      error: null,
    });
    if (!completed) {
      throw new Error(`Segment compare run ${runId} disappeared during save.`);
    }
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await patchSegmentCompareRun(meetingId, runId, {
      status: "failed",
      progressLabel: null,
      error: message,
      completedAt: new Date().toISOString(),
    });
    if (failed) return failed;
    throw error;
  }
}
