/**
 * Production transcript segmentation: walk, span-edge review, then hole fill.
 * The caller supplies the cues. Nothing here writes agenda rows.
 */

import { applyAgendaHierarchyCorrections } from "@/lib/meeting-v2/agenda-outline";
import {
  TRANSCRIPT_SYSTEM_PROMPT,
  applyAdHocOutlinePlacement,
  buildTranscriptUserText,
  completeAgendaChunk,
  isNoChangeResponse,
  normalizeWorkflowState,
  parseWithRepair,
  rehomeOverflowDiscussionTopics,
  sortTopics,
  type WorkflowState,
  type WorkflowTopic,
} from "@/lib/meeting-v2/agenda-ai";
import { chunkTranscriptSegments, type TranscriptChunkSegment } from "@/lib/meeting-v2/chunking";
import {
  assignRemainingHolesToAgenda,
  assignUnmatchedLeavesInHoles,
  createGapHoleJudge,
  extendFloorThroughLifecycleHoles,
} from "@/lib/meeting-v2/gap-leaf-assignment";
import type { SegmentationJsonFn } from "@/lib/meeting-v2/segment-json";
import {
  createSpanEdgeJudge,
  reviewTranscriptTopicSpans,
  type SpanReviewCue,
} from "@/lib/meeting-v2/span-edge-review";

/** Agenda row used to seed the walk. Timing already stored on the row is ignored. */
export type SegmentAgendaSeed = {
  title: string;
  sectionLabel: string | null;
  itemType: string;
  itemNumber: string | null;
  sourcePagesJson: string;
  sourceText: string | null;
};

/**
 * Builds the walk state from a stored outline.
 * Discussion timing on the source text is removed so this run assigns stretches again.
 */
export function seedStateFromAgendaItems(items: readonly SegmentAgendaSeed[]): WorkflowState {
  const documentTopics = items.map((item) => {
    const pages = parsePages(item.sourcePagesJson);
    return {
      title: item.title,
      sectionLabel: item.sectionLabel?.trim() || "Unknown",
      itemType: item.itemType,
      itemNumber: item.itemNumber?.trim() || undefined,
      visibility: "PUBLIC" as const,
      sourcePages: pages,
      sourceChunkIds: [],
      sourceTranscriptRanges: [],
      discussionStatus: "not_discussed" as const,
      discussionTimestampRange: null,
      consolidationReason: null,
      sourceText: stripSeededTiming(item.sourceText),
      aliases: [],
      notes: [],
      confidence: 1,
      confidenceReason: "Seeded from stored agenda outline",
      evidenceStrength: "DIRECT" as const,
      openQuestions: [],
      needsHumanReview: false,
      humanReviewReason: null,
    } satisfies WorkflowTopic;
  });
  return {
    documentTopics,
    extraTopics: [],
    uncertainties: [],
    packageItemNumbers: documentTopics
      .filter((topic) => topic.sourcePages.length > 0 || /items for discussion/i.test(topic.title))
      .map((topic) => topic.itemNumber)
      .filter((code): code is string => Boolean(code)),
  };
}

/**
 * Assigns transcript stretches with the Meetings V2 walk, edge review, and hole fill.
 * Throws when a model reply cannot be read. Does not write the database.
 */
export async function segmentAgendaTopics(options: {
  meetingId: string;
  items: readonly SegmentAgendaSeed[];
  cues: readonly SpanReviewCue[];
  generate?: SegmentationJsonFn;
  onProgress?: (label: string) => Promise<void> | void;
}): Promise<WorkflowTopic[]> {
  const generate = options.generate;
  let state = seedStateFromAgendaItems(options.items);
  const chunks = chunkTranscriptSegments(cuesToChunkSegments(options.cues));
  const report = options.onProgress ?? (() => undefined);

  for (const chunk of chunks) {
    await report(`Walking transcript chunk ${chunk.sortOrder + 1}/${chunks.length}`);
    const response = await completeAgendaChunk({
      systemInstruction: TRANSCRIPT_SYSTEM_PROMPT,
      userText: buildTranscriptUserText({
        meetingId: options.meetingId,
        state,
        chunkIndex: chunk.sortOrder,
        chunkTotal: chunks.length,
        chunkId: chunk.aiChunkId,
        sequenceRange: chunk.metadata.sequenceRange,
        chunkText: chunk.text,
      }),
      generate,
    });
    const parsed = await parseWithRepair(response.text, generate);
    if (!isNoChangeResponse(parsed)) {
      state = normalizeWorkflowState(parsed, state);
    } else {
      state = rehomeOverflowDiscussionTopics(state);
    }
  }

  const placed = applyAdHocOutlinePlacement(state);
  let topics = applyAgendaHierarchyCorrections(
    sortTopics([...placed.documentTopics, ...placed.extraTopics]).map((topic, index) => ({
      ...topic,
      id: `topic-${index}`,
      itemNumber: topic.itemNumber || String(index + 1),
    })),
  );

  const cues = [...options.cues];
  const edgeJudge = generate ? createSpanEdgeJudge(generate) : undefined;
  const outlineGapJudge = generate ? createGapHoleJudge(generate, "outline") : undefined;
  const remainingGapJudge = generate ? createGapHoleJudge(generate, "remaining") : undefined;

  await report("Reviewing transcript span edges");
  const reviewed = await reviewTranscriptTopicSpans({
    topics,
    cues,
    judge: edgeJudge,
    onProgress: report,
  });
  const gapped = await assignUnmatchedLeavesInHoles({
    topics: reviewed,
    cues,
    judge: outlineGapJudge,
    onProgress: report,
  });
  const leftover = await assignRemainingHolesToAgenda({
    topics: gapped,
    cues,
    judge: remainingGapJudge,
    onProgress: report,
  });
  const wrapped = extendFloorThroughLifecycleHoles({ topics: leftover, cues });
  topics = topics.map((topic, index) => ({
    ...topic,
    discussionTimestampRange:
      wrapped[index]?.discussionTimestampRange ?? topic.discussionTimestampRange,
    sourceTranscriptRanges:
      wrapped[index]?.sourceTranscriptRanges ?? topic.sourceTranscriptRanges,
    discussionStatus: wrapped[index]?.discussionStatus ?? topic.discussionStatus,
  }));
  return applyAgendaHierarchyCorrections(topics);
}

function cuesToChunkSegments(cues: readonly SpanReviewCue[]): TranscriptChunkSegment[] {
  return cues.map((cue) => ({
    sequence: cue.sequence,
    startTimestamp: cue.startTimestamp,
    endTimestamp: clockFromSeconds(cue.endSeconds),
    speakerLabel: cue.speaker,
    text: cue.text,
  }));
}

function clockFromSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${String(millis).padStart(3, "0")}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parsePages(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((page) =>
      typeof page === "number" && Number.isFinite(page) ? [Math.trunc(page)] : [],
    );
  } catch {
    return [];
  }
}

function stripSeededTiming(sourceText: string | null): string | null {
  if (!sourceText) return null;
  return (
    sourceText
      .split("\n")
      .filter((line) => !/^\s*(discussion status|discussion timing):/i.test(line))
      .join("\n")
      .trim() || null
  );
}
