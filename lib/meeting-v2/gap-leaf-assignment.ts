import { generateDeepSeekJson } from "@/lib/deepseek/client";
import {
  compareAgendaItemCodes,
  formatClockFromSeconds,
  parseClockToSeconds,
  parseDiscussionTimestampRanges,
  type TimestampRange,
} from "@/lib/meeting-v2/agenda-outline";
import {
  applyTopicClockSpans,
  cuesInWindow,
  isOutlineLeafTopic,
  listUnmatchedLaterLeaves,
  topicClockSpans,
  type SpanReviewCue,
  type SpanReviewTopic,
} from "@/lib/meeting-v2/span-edge-review";

export const GAP_WINDOW_SECONDS = 120;
export const GAP_MAX_WINDOWS = 16;
export const GAP_MIN_SECONDS = 8;

export type TranscriptHole = {
  startSeconds: number;
  endSeconds: number;
  left: SpanReviewTopic;
  right: SpanReviewTopic | null;
  unmatched: SpanReviewTopic[];
};

export type GapOpen = {
  itemNumber: string;
  startSeconds: number;
  endSeconds: number;
};

export type GapJudgeDecision = {
  extendFloorTo: number | null;
  opens: GapOpen[];
};

export type GapHoleJudge = (input: {
  floor: SpanReviewTopic;
  unmatched: SpanReviewTopic[];
  rightTitle: string | null;
  windowStartSeconds: number;
  windowEndSeconds: number;
  cues: SpanReviewCue[];
}) => Promise<GapJudgeDecision>;

function lastAssignedLeafSpans(
  topics: SpanReviewTopic[],
): Array<{ topic: SpanReviewTopic; startSeconds: number; endSeconds: number }> {
  const leaves = topics.filter((topic) => isOutlineLeafTopic(topic, topics));
  const spans: Array<{ topic: SpanReviewTopic; startSeconds: number; endSeconds: number }> = [];
  for (const topic of leaves) {
    for (const span of topicClockSpans(topic)) {
      spans.push({
        topic,
        startSeconds: span.startSeconds,
        endSeconds: span.endSeconds,
      });
    }
  }
  spans.sort((left, right) => left.startSeconds - right.startSeconds);
  return spans;
}

export function findTranscriptHoles(
  topics: SpanReviewTopic[],
  cues: SpanReviewCue[],
): TranscriptHole[] {
  const assigned = lastAssignedLeafSpans(topics);
  if (assigned.length === 0) return [];
  const lastCueEnd = cues.reduce((max, cue) => Math.max(max, cue.endSeconds), 0);
  const holes: TranscriptHole[] = [];

  const pushHole = (
    startSeconds: number,
    endSeconds: number,
    left: SpanReviewTopic,
    right: SpanReviewTopic | null,
  ) => {
    if (endSeconds - startSeconds < GAP_MIN_SECONDS) return;
    const unmatched = listUnmatchedLaterLeaves(left, startSeconds, topics).filter((topic) => {
      if (!right?.itemNumber) return true;
      return compareAgendaItemCodes(topic.itemNumber, right.itemNumber) < 0;
    });
    holes.push({ startSeconds, endSeconds, left, right, unmatched });
  };

  for (let index = 0; index < assigned.length; index += 1) {
    const current = assigned[index];
    const next = assigned[index + 1];
    if (!next) {
      if (lastCueEnd > current.endSeconds + GAP_MIN_SECONDS) {
        pushHole(current.endSeconds, lastCueEnd, current.topic, null);
      }
      break;
    }
    if (current.topic.itemNumber === next.topic.itemNumber) continue;
    pushHole(current.endSeconds, next.startSeconds, current.topic, next.topic);
  }
  return holes;
}

function parseGapJudgeJson(text: string): GapJudgeDecision {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return { extendFloorTo: null, opens: [] };
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const extendFloorTo = parseClockToSeconds(
      typeof parsed.extendFloorTo === "string" ? parsed.extendFloorTo : null,
    );
    const opensRaw = Array.isArray(parsed.opens) ? parsed.opens : [];
    const opens: GapOpen[] = [];
    for (const entry of opensRaw) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const itemNumber = typeof record.itemNumber === "string" ? record.itemNumber.trim() : "";
      const startSeconds = parseClockToSeconds(
        typeof record.startTimestamp === "string" ? record.startTimestamp : null,
      );
      const endSeconds = parseClockToSeconds(
        typeof record.endTimestamp === "string" ? record.endTimestamp : null,
      );
      if (!itemNumber || startSeconds === null || endSeconds === null) continue;
      if (endSeconds <= startSeconds) continue;
      opens.push({ itemNumber, startSeconds, endSeconds });
    }
    return { extendFloorTo, opens };
  } catch {
    return { extendFloorTo: null, opens: [] };
  }
}

const GAP_SYSTEM_PROMPT = `You assign unmatched condominium board package agenda leaves to a hole in the transcript overlay.

Walk cues in clock order. Each cue is OPEN (names a different matter), ENRICH, or CHANGE LIFECYCLE (assent / wrap-up of the floor item).

Rules:
- Keep extending the floor item through wrap-up ("thank you", "that's great", "felt heard") until the next matter is named.
- When speakers name a different unit, asset, or unmatched package leaf, OPEN that leaf. The previous floor span may continue until assent completes (overlap is allowed).
- Do not skip later lettered leaves in the same section when they are named in this window.
- Only OPEN itemNumbers from the unmatched list.
- Return JSON only.`;

async function defaultGapJudge(input: {
  floor: SpanReviewTopic;
  unmatched: SpanReviewTopic[];
  rightTitle: string | null;
  windowStartSeconds: number;
  windowEndSeconds: number;
  cues: SpanReviewCue[];
}): Promise<GapJudgeDecision> {
  const unmatchedList =
    input.unmatched.length === 0
      ? "(none)"
      : input.unmatched
          .map((topic) => `${topic.itemNumber ?? "?"} — ${topic.title}`)
          .join("\n");
  const userText = `FLOOR ITEM: ${input.floor.itemNumber ?? "?"} — ${input.floor.title}
NEXT RANGED ITEM: ${input.rightTitle ?? "(end of transcript)"}
WINDOW: ${formatClockFromSeconds(input.windowStartSeconds)} – ${formatClockFromSeconds(input.windowEndSeconds)}

UNMATCHED PACKAGE LEAVES IN THIS HOLE:
${unmatchedList}

If wrap-up of the floor continues, set extendFloorTo to the last cue still on the floor.
If an unmatched leaf is named, add an opens entry. Overlap with the floor is allowed.

Return:
{"extendFloorTo":"HH:MM:SS"|null,"opens":[{"itemNumber":"4.D.h","startTimestamp":"HH:MM:SS","endTimestamp":"HH:MM:SS"}]}

CUES:
${input.cues
  .map(
    (cue) =>
      `${cue.startTimestamp} seq=${cue.sequence} ${cue.speaker.trim() || "Unknown"}: ${cue.text}`,
  )
  .join("\n")}`;

  const response = await generateDeepSeekJson({
    systemInstruction: GAP_SYSTEM_PROMPT,
    userText,
    modelName: "deepseek-v4-flash",
    maxOutputTokens: 700,
    temperature: 0,
    thinking: false,
  });
  return parseGapJudgeJson(response.text);
}

function topicIndex(topics: SpanReviewTopic[], itemNumber: string): number {
  const needle = itemNumber.trim().toLowerCase();
  return topics.findIndex((topic) => (topic.itemNumber || "").trim().toLowerCase() === needle);
}

function addSpanToTopic(
  topic: SpanReviewTopic,
  span: TimestampRange,
  cues: SpanReviewCue[],
): SpanReviewTopic {
  const existing = topicClockSpans(topic);
  const next = applyTopicClockSpans(topic, [...existing, span], cues);
  return {
    ...next,
    discussionStatus: "discussed",
  };
}

async function fillHolesWithJudge(options: {
  topics: SpanReviewTopic[];
  cues: SpanReviewCue[];
  holes: TranscriptHole[];
  remainingForHole: (hole: TranscriptHole, topics: SpanReviewTopic[]) => string[];
  judge: GapHoleJudge;
  progressLabel: (hole: TranscriptHole) => string;
  onProgress?: (label: string) => Promise<void> | void;
}): Promise<SpanReviewTopic[]> {
  const topics = options.topics.map((topic) => ({ ...topic }));

  for (const hole of options.holes) {
    await options.onProgress?.(options.progressLabel(hole));
    let cursor = hole.startSeconds;
    let floorIndex = topics.findIndex(
      (topic) =>
        (topic.itemNumber || "").trim().toLowerCase() ===
        (hole.left.itemNumber || "").trim().toLowerCase(),
    );
    if (floorIndex < 0) continue;
    let remaining = options.remainingForHole(hole, topics);

    for (let window = 0; window < GAP_MAX_WINDOWS && cursor < hole.endSeconds - 1; window += 1) {
      const windowEnd = Math.min(cursor + GAP_WINDOW_SECONDS, hole.endSeconds);
      const windowCues = cuesInWindow(options.cues, cursor, windowEnd);
      if (windowCues.length === 0) {
        cursor = windowEnd;
        continue;
      }
      const unmatchedTopics = remaining
        .map((code) => topics.find((topic) => (topic.itemNumber || "").trim().toLowerCase() === code))
        .filter((topic): topic is SpanReviewTopic => Boolean(topic));

      const decision = await options.judge({
        floor: topics[floorIndex],
        unmatched: unmatchedTopics,
        rightTitle: hole.right?.title ?? null,
        windowStartSeconds: cursor,
        windowEndSeconds: windowEnd,
        cues: windowCues,
      });

      let advancedTo = cursor;
      const floorSpans = topicClockSpans(topics[floorIndex]);
      const floorSpan = floorSpans[floorSpans.length - 1];
      if (decision.extendFloorTo && floorSpan && decision.extendFloorTo > floorSpan.endSeconds + 0.5) {
        topics[floorIndex] = addSpanToTopic(
          topics[floorIndex],
          {
            startSeconds: floorSpan.startSeconds,
            endSeconds: Math.min(decision.extendFloorTo, hole.endSeconds),
          },
          options.cues,
        );
        advancedTo = Math.max(advancedTo, Math.min(decision.extendFloorTo, windowEnd));
      }

      for (const open of decision.opens) {
        const index = topicIndex(topics, open.itemNumber);
        if (index < 0) continue;
        const code = open.itemNumber.trim().toLowerCase();
        if (!remaining.includes(code)) continue;
        const startSeconds = Math.max(open.startSeconds, hole.startSeconds);
        const endSeconds = Math.min(open.endSeconds, hole.endSeconds);
        if (endSeconds <= startSeconds) continue;
        topics[index] = addSpanToTopic(
          topics[index],
          { startSeconds, endSeconds },
          options.cues,
        );
        remaining = remaining.filter((item) => item !== code);
        floorIndex = index;
        advancedTo = Math.max(advancedTo, Math.min(endSeconds, windowEnd));
      }

      if (advancedTo <= cursor + 0.5) {
        cursor = windowEnd;
      } else {
        cursor = advancedTo;
      }
    }
  }

  return topics;
}

export async function assignUnmatchedLeavesInHoles(options: {
  topics: SpanReviewTopic[];
  cues: SpanReviewCue[];
  judge?: GapHoleJudge;
  onProgress?: (label: string) => Promise<void> | void;
}): Promise<SpanReviewTopic[]> {
  const holes = findTranscriptHoles(options.topics, options.cues).filter(
    (hole) => hole.unmatched.length > 0,
  );
  return fillHolesWithJudge({
    topics: options.topics,
    cues: options.cues,
    holes,
    remainingForHole: (hole) =>
      hole.unmatched.map((topic) => topic.itemNumber?.trim().toLowerCase() ?? "").filter(Boolean),
    judge: options.judge ?? defaultGapJudge,
    progressLabel: (hole) =>
      `Assigning unmatched items in transcript gap ${formatClockFromSeconds(hole.startSeconds)}–${formatClockFromSeconds(hole.endSeconds)}`,
    onProgress: options.onProgress,
  });
}

export function listUnassignedLeaves(topics: SpanReviewTopic[]): SpanReviewTopic[] {
  return topics.filter(
    (topic) => isOutlineLeafTopic(topic, topics) && topicClockSpans(topic).length === 0,
  );
}

const REMAINING_HOLE_SYSTEM_PROMPT = `You assign leftover unboxed transcript (a hole between extracted discussion spans) to the meeting agenda.

The hole is after the floor item and before the next ranged item. Speakers often take an official agenda item out of outline order (for example the next board meeting date between two ad-hoc property-management items).

Rules:
- OPEN an unassigned agenda leaf when this window is clearly that matter. Only use itemNumbers from the unassigned list.
- Discussion of "next board meeting", "next meeting date", or scheduling the next meeting belongs to that agenda leaf even if a later ad-hoc item already has a transcript range after this hole.
- Extend the floor only through wrap-up / thanks that still belong to it.
- Leave the window unassigned when it is skippable chatter or the start of the next ranged item. Do not invent itemNumbers.
- Return JSON only.`;

async function defaultRemainingHoleJudge(input: {
  floor: SpanReviewTopic;
  unmatched: SpanReviewTopic[];
  rightTitle: string | null;
  windowStartSeconds: number;
  windowEndSeconds: number;
  cues: SpanReviewCue[];
}): Promise<GapJudgeDecision> {
  const unmatchedList =
    input.unmatched.length === 0
      ? "(none)"
      : input.unmatched
          .map((topic) => `${topic.itemNumber ?? "?"} — ${topic.title}`)
          .join("\n");
  const userText = `FLOOR ITEM: ${input.floor.itemNumber ?? "?"} — ${input.floor.title}
NEXT RANGED ITEM: ${input.rightTitle ?? "(end of transcript)"}
WINDOW: ${formatClockFromSeconds(input.windowStartSeconds)} – ${formatClockFromSeconds(input.windowEndSeconds)}

UNASSIGNED AGENDA LEAVES (may be discussed out of outline order in this hole):
${unmatchedList}

If wrap-up of the floor continues, set extendFloorTo to the last cue still on the floor.
If an unassigned leaf is what this window is about, add an opens entry. Overlap with the floor is allowed.
If this is chatter or the next ranged item, return empty opens and null extendFloorTo.

Return:
{"extendFloorTo":"HH:MM:SS"|null,"opens":[{"itemNumber":"5","startTimestamp":"HH:MM:SS","endTimestamp":"HH:MM:SS"}]}

CUES:
${input.cues
  .map(
    (cue) =>
      `${cue.startTimestamp} seq=${cue.sequence} ${cue.speaker.trim() || "Unknown"}: ${cue.text}`,
  )
  .join("\n")}`;

  const response = await generateDeepSeekJson({
    systemInstruction: REMAINING_HOLE_SYSTEM_PROMPT,
    userText,
    modelName: "deepseek-v4-flash",
    maxOutputTokens: 700,
    temperature: 0,
    thinking: false,
  });
  return parseGapJudgeJson(response.text);
}

/**
 * After span-edge and outline-order hole assignment, leftover overlay holes
 * can still hold an official agenda leaf discussed out of order (item 5
 * between two 4.E.* ad-hoc spans). This pass maps those holes to any
 * still-unassigned leaf.
 */
export async function assignRemainingHolesToAgenda(options: {
  topics: SpanReviewTopic[];
  cues: SpanReviewCue[];
  judge?: GapHoleJudge;
  onProgress?: (label: string) => Promise<void> | void;
}): Promise<SpanReviewTopic[]> {
  const holes = findTranscriptHoles(options.topics, options.cues);
  return fillHolesWithJudge({
    topics: options.topics,
    cues: options.cues,
    holes,
    remainingForHole: (hole, topics) => {
      const rightCode = hole.right?.itemNumber?.trim().toLowerCase() ?? "";
      const leftCode = hole.left.itemNumber?.trim().toLowerCase() ?? "";
      return listUnassignedLeaves(topics)
        .map((topic) => topic.itemNumber?.trim().toLowerCase() ?? "")
        .filter((code) => code && code !== leftCode && code !== rightCode);
    },
    judge: options.judge ?? defaultRemainingHoleJudge,
    progressLabel: (hole) =>
      `Assigning leftover transcript gap ${formatClockFromSeconds(hole.startSeconds)}–${formatClockFromSeconds(hole.endSeconds)}`,
    onProgress: options.onProgress,
  });
}

export function discussionTimingPresent(topic: {
  discussionTimestampRange?: string | null;
}): boolean {
  return parseDiscussionTimestampRanges(topic.discussionTimestampRange).length > 0;
}
