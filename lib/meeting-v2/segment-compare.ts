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
import { loadMeetingV2AiUsageStages } from "@/lib/meeting-v2/ai-usage";
import type { MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { canonicalDiscussionTiming, withCanonicalDiscussionTiming } from "@/lib/meeting-v2/canonical-timing";
import type { CanonicalAgendaEvidence } from "@/lib/meeting-v2/evidence-contract";
import { resolveMeetingV2SegmentMilestonePercent } from "@/lib/meeting-v2/pipeline-segment-timing";
import { resetMeetingV2PostExtractData, updateMeetingV2Status } from "@/lib/meeting-v2/service";
import {
  agendaConceptRows,
  mergeGoldSpans,
  normalizeSegmentGoldStandard,
  overlaysFromGoldSpans,
  sequenceRangesForTimeSpans,
  unionChildSequenceRanges,
  type AgendaConceptRow,
  type SegmentGoldStandard,
  type SegmentGoldSpan,
} from "@/lib/meeting-v2/segment-gold-standard";
import {
  buildSegmentCompareCostBaseline,
  type SegmentCompareCostBaseline,
} from "@/lib/meeting-v2/segment-compare-cost-estimates";
import { formatGeminiApiErrorMessage } from "@/lib/gemini/client";
import type { TokenUsage } from "@/lib/gemini/usage";
import {
  assignRemainingHolesToAgenda,
  assignUnmatchedLeavesInHoles,
  createGapHoleJudge,
  extendFloorThroughLifecycleHoles,
  findTranscriptHoles,
} from "@/lib/meeting-v2/gap-leaf-assignment";
import {
  estimateSegmentCompareCostUsd,
  segmentCompareModel,
  type SegmentCompareRun,
  type SegmentCompareSlotChoice,
  type SegmentCompareUsage,
} from "@/lib/meeting-v2/segment-compare-models";
import { createSegmentationJsonFn, type SegmentationJsonFn } from "@/lib/meeting-v2/segment-json";
import {
  createSpanEdgeJudge,
  reviewTranscriptTopicSpans,
  SPAN_EDGE_MAX_ROUNDS,
  transcriptSegmentsToReviewCues,
  type SpanReviewCue,
  type SpanReviewTopic,
} from "@/lib/meeting-v2/span-edge-review";
import type { MergedVttCue } from "@/lib/parsers/vtt";
import {
  buildTranscriptSectionOverlays,
  discussionTimingFromSourceText,
  type TranscriptSectionOverlay,
} from "@/lib/transcript/section-overlay";

const MAX_STORED_RUNS = 20;

function estimateEdgeProgressSteps(topics: SpanReviewTopic[], cues: SpanReviewCue[]): number {
  const holes = findTranscriptHoles(topics, cues);
  const unmatchedHoleCount = holes.filter((hole) => hole.unmatched.length > 0).length;
  return SPAN_EDGE_MAX_ROUNDS + unmatchedHoleCount + holes.length;
}

function createPhaseStepProgress(
  emit: (label: string) => Promise<void>,
  phase: "Walk" | "Edge",
  total: number,
) {
  let step = 0;
  return async () => {
    step += 1;
    await emit(`${phase} ${step}/${Math.max(total, step)}`);
  };
}

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

async function writeMeetingSettings(
  meetingId: string,
  settings: MeetingV2Settings,
): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({
      settings,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingsV2.id, meetingId));
}

async function writeRuns(meetingId: string, runs: SegmentCompareRun[]): Promise<void> {
  const { settings } = await loadMeetingSettings(meetingId);
  await writeMeetingSettings(meetingId, { ...settings, segmentCompareRuns: runs });
}

export async function listSegmentCompareReviewedKeys(meetingId: string): Promise<string[]> {
  const { settings } = await loadMeetingSettings(meetingId);
  return settings.segmentCompareReviewedKeys ?? [];
}

export async function setSegmentCompareReviewedKeys(
  meetingId: string,
  keys: string[],
): Promise<string[]> {
  const { settings } = await loadMeetingSettings(meetingId);
  const unique = [...new Set(keys)];
  await writeMeetingSettings(meetingId, {
    ...settings,
    segmentCompareReviewedKeys: unique,
  });
  return unique;
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

async function loadExtractWalkTokenUsage(meetingId: string): Promise<TokenUsage | null> {
  try {
    const stages = await loadMeetingV2AiUsageStages(meetingId);
    const extract = stages.find((stage) => stage.id === "extract");
    if (!extract || extract.notApplicable || extract.inputTokens <= 0) {
      return null;
    }
    return {
      inputTokens: extract.inputTokens,
      outputTokens: extract.outputTokens,
      totalTokens: extract.totalTokens,
      cacheHitTokens: extract.cacheHitTokens,
      cacheMissTokens: extract.cacheMissTokens,
    };
  } catch (error) {
    console.warn("[segment-compare] extract walk usage unavailable", error);
    return null;
  }
}

export async function loadSegmentCompareWorkspace(meetingId: string): Promise<{
  cues: MergedVttCue[];
  savedOverlays: TranscriptSectionOverlay[];
  runs: SegmentCompareRun[];
  reviewedKeys: string[];
  agendaItemCount: number;
  costBaseline: SegmentCompareCostBaseline | null;
  agendaConcepts: AgendaConceptRow[];
  goldStandard: SegmentGoldStandard | null;
  goldOverlays: TranscriptSectionOverlay[];
}> {
  const db = getDb();
  const [segments, agendaItems, { settings }] = await Promise.all([
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
    loadMeetingSettings(meetingId),
  ]);
  const runs = settings.segmentCompareRuns ?? [];
  const reviewedKeys = settings.segmentCompareReviewedKeys ?? [];
  const extractWalkUsage = await loadExtractWalkTokenUsage(meetingId);
  const agendaConcepts = agendaConceptRows(agendaItems);
  const allowedIds = new Set(agendaConcepts.map((concept) => concept.id));
  const goldStandard = normalizeSegmentGoldStandard(settings.segmentGoldStandard, allowedIds);
  const goldOverlays = overlaysFromGoldSpans(agendaConcepts, goldStandard?.spans ?? []);
  const costBaseline = buildSegmentCompareCostBaseline(runs, extractWalkUsage);
  return {
    cues: transcriptSegmentsToCues(segments),
    savedOverlays: overlaysFromSavedAgenda(agendaItems),
    runs,
    reviewedKeys,
    agendaItemCount: agendaItems.length,
    costBaseline,
    agendaConcepts,
    goldStandard,
    goldOverlays,
  };
}

export async function setSegmentGoldStandard(
  meetingId: string,
  spans: SegmentGoldSpan[],
): Promise<SegmentGoldStandard> {
  const db = getDb();
  const agendaItems = await db
    .select({
      id: meetingsV2AgendaItems.id,
      title: meetingsV2AgendaItems.title,
      itemNumber: meetingsV2AgendaItems.itemNumber,
    })
    .from(meetingsV2AgendaItems)
    .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId));
  const allowedIds = new Set(agendaItems.map((item) => item.id));
  const goldStandard: SegmentGoldStandard = {
    updatedAt: new Date().toISOString(),
    spans: mergeGoldSpans(spans.filter((span) => allowedIds.has(span.agendaItemId))),
  };
  const { settings } = await loadMeetingSettings(meetingId);
  await writeMeetingSettings(meetingId, { ...settings, segmentGoldStandard: goldStandard });
  return goldStandard;
}

export async function applyGoldStandardToMinutesPipeline(meetingId: string): Promise<{
  spanCount: number;
  labeledLeafCount: number;
}> {
  const db = getDb();
  const { settings } = await loadMeetingSettings(meetingId);
  const gold = normalizeSegmentGoldStandard(settings.segmentGoldStandard);
  if (!gold || gold.spans.length === 0) {
    throw new Error("Label at least one gold-standard span before running the minutes pipeline.");
  }

  const [agendaItems, segments] = await Promise.all([
    db
      .select()
      .from(meetingsV2AgendaItems)
      .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2AgendaItems.sortOrder)),
    db
      .select({
        sequence: meetingsV2TranscriptSegments.sequence,
        startTimestamp: meetingsV2TranscriptSegments.startTimestamp,
        endTimestamp: meetingsV2TranscriptSegments.endTimestamp,
      })
      .from(meetingsV2TranscriptSegments)
      .where(eq(meetingsV2TranscriptSegments.meetingV2Id, meetingId))
      .orderBy(asc(meetingsV2TranscriptSegments.sequence)),
  ]);
  if (agendaItems.length === 0) {
    throw new Error("Extract the agenda before applying gold-standard spans.");
  }
  if (segments.length === 0) {
    throw new Error("No transcript segments found for this meeting.");
  }

  const concepts = agendaConceptRows(agendaItems);
  const leafIds = new Set(concepts.filter((concept) => concept.isLeaf).map((concept) => concept.id));
  const spansByItem = new Map<string, SegmentGoldSpan[]>();
  for (const span of gold.spans) {
    if (!leafIds.has(span.agendaItemId)) continue;
    const list = spansByItem.get(span.agendaItemId) ?? [];
    list.push(span);
    spansByItem.set(span.agendaItemId, list);
  }

  const leafRanges = new Map<string, Array<[number, number]>>();
  for (const [itemId, spans] of spansByItem) {
    leafRanges.set(itemId, sequenceRangesForTimeSpans(spans, segments));
  }
  const rangesById = unionChildSequenceRanges(agendaItems, leafRanges);
  const priorEvidence = settings.agendaEvidence ?? {};
  const agendaEvidence: Record<string, CanonicalAgendaEvidence> = {};
  const itemStatuses: Record<string, "discussed" | "not_discussed" | "ad_hoc"> = {
    ...(settings.agendaApproval?.itemStatuses ?? {}),
  };

  for (const item of agendaItems) {
    const prior = priorEvidence[item.id];
    const ranges = rangesById.get(item.id) ?? [];
    agendaEvidence[item.id] = {
      itemNumber: item.itemNumber,
      sourceTranscriptRanges: ranges,
      sourceChunkIds: prior?.sourceChunkIds ?? [],
      aliases: prior?.aliases ?? [],
      notes: prior?.notes ?? [],
      visibility: prior?.visibility,
    };
    const existingStatus = itemStatuses[item.id];
    if (existingStatus === "ad_hoc") {
      continue;
    }
    itemStatuses[item.id] = ranges.length > 0 ? "discussed" : "not_discussed";
  }

  for (const item of agendaItems) {
    const timing = canonicalDiscussionTiming(agendaEvidence[item.id].sourceTranscriptRanges, segments);
    await db
      .update(meetingsV2AgendaItems)
      .set({ sourceText: withCanonicalDiscussionTiming(item.sourceText, timing) })
      .where(eq(meetingsV2AgendaItems.id, item.id));
  }

  await writeMeetingSettings(meetingId, {
    ...settings,
    agendaEvidence,
    draftReadiness: {
      ready: false,
      problems: ["Gold-standard transcript spans were applied. Re-run evidence, investigation, and validation."],
      checkedAt: new Date().toISOString(),
    },
    agendaApproval: {
      status: "approved",
      approvedAt: new Date().toISOString(),
      itemStatuses,
      excludedItemIds: settings.agendaApproval?.excludedItemIds ?? [],
      discrepancies: settings.agendaApproval?.discrepancies ?? [],
    },
  });

  await resetMeetingV2PostExtractData(meetingId);
  const evidenceStartPercent = await resolveMeetingV2SegmentMilestonePercent("evidence", "start");
  await updateMeetingV2Status(
    meetingId,
    "gathering_evidence",
    "Gold-standard spans applied. Assembling evidence context...",
    evidenceStartPercent,
    null,
  );

  return {
    spanCount: gold.spans.length,
    labeledLeafCount: spansByItem.size,
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
    const partialWalk =
      walkMeter.totalTokens > 0 ? usageFromMeter(existing.walk, walkMeter) : null;
    const partialEdge =
      edgeMeter.totalTokens > 0 ? usageFromMeter(existing.edge, edgeMeter) : null;
    const partialUsd = (partialWalk?.costUsd ?? 0) + (partialEdge?.costUsd ?? 0);
    await patchSegmentCompareRun(meetingId, runId, {
      status: "running",
      progressLabel: label,
      walkUsage: partialWalk,
      edgeUsage: partialEdge,
      totalCostUsd: partialUsd > 0 ? partialUsd : null,
    });
  };

  const walkMeter = emptyMeter();
  const edgeMeter = emptyMeter();

  try {
    await progress("Loading");
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

    const walkProgress = createPhaseStepProgress(progress, "Walk", transcriptChunks.length);
    for (const chunk of transcriptChunks) {
      await walkProgress();
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
        id: `topic-${index}`,
        itemNumber: topic.itemNumber || String(index + 1),
      })),
    );

    const cues = transcriptSegmentsToReviewCues(transcriptSegments);
    const edgeJudge = createSpanEdgeJudge(edgeGenerate);
    const outlineGapJudge = createGapHoleJudge(edgeGenerate, "outline");
    const remainingGapJudge = createGapHoleJudge(edgeGenerate, "remaining");

    const edgeProgress = createPhaseStepProgress(
      progress,
      "Edge",
      estimateEdgeProgressSteps(finalTopics, cues),
    );
    const reviewed = await reviewTranscriptTopicSpans({
      topics: finalTopics,
      cues,
      judge: edgeJudge,
      onProgress: edgeProgress,
    });
    const gapped = await assignUnmatchedLeavesInHoles({
      topics: reviewed,
      cues,
      judge: outlineGapJudge,
      onProgress: edgeProgress,
    });
    const leftover = await assignRemainingHolesToAgenda({
      topics: gapped,
      cues,
      judge: remainingGapJudge,
      onProgress: edgeProgress,
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
    const friendly = formatGeminiApiErrorMessage(error);
    const message =
      friendly ?? (error instanceof Error ? error.message : String(error));
    const walkUsage =
      walkMeter.totalTokens > 0 ? usageFromMeter(existing.walk, walkMeter) : null;
    const edgeUsage =
      edgeMeter.totalTokens > 0 ? usageFromMeter(existing.edge, edgeMeter) : null;
    const partialUsd = (walkUsage?.costUsd ?? 0) + (edgeUsage?.costUsd ?? 0);
    const totalCostUsd =
      walkMeter.totalTokens > 0 || edgeMeter.totalTokens > 0 ? partialUsd : null;
    const failed = await patchSegmentCompareRun(meetingId, runId, {
      status: "failed",
      progressLabel: null,
      error: message,
      completedAt: new Date().toISOString(),
      walkUsage,
      edgeUsage,
      totalCostUsd,
    });
    if (failed) return failed;
    throw error;
  }
}
