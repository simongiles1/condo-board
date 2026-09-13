import { generateDeepSeekJson } from "@/lib/deepseek/client";
import {
  compareAgendaItemCodes,
  formatClockFromSeconds,
  formatDiscussionTimestampRanges,
  mergeClosedIntervals,
  parentAgendaItemCode,
  parseClockToSeconds,
  parseDiscussionTimestampRanges,
  type TimestampRange,
} from "@/lib/meeting-v2/agenda-outline";

/** Forward look-ahead per loop. A 6-minute hole takes about four loops. */
export const SPAN_EDGE_WINDOW_SECONDS = 120;
export const SPAN_EDGE_BACK_WINDOW_SECONDS = 60;
/** 12 × 2 minutes = 24 minutes of growth per span — enough for long interior holes. */
export const SPAN_EDGE_MAX_FORWARD_LOOPS = 12;
export const SPAN_EDGE_MAX_ROUNDS = 3;

export type SpanReviewCue = {
  sequence: number;
  startSeconds: number;
  endSeconds: number;
  startTimestamp: string;
  speaker: string;
  text: string;
};

export type SpanReviewTopic = {
  title: string;
  itemNumber?: string;
  discussionStatus?: "discussed" | "not_discussed" | "ad_hoc";
  discussionTimestampRange?: string | null;
  sourceTranscriptRanges: Array<[number, number]>;
};

export type SpanEdgeJudge = (input: {
  topic: SpanReviewTopic;
  direction: "forward" | "backward" | "trim_start";
  windowStartSeconds: number;
  windowEndSeconds: number;
  cues: SpanReviewCue[];
  nextForeignTitle: string | null;
  unmatchedLaterLeaves: Array<{ itemNumber?: string; title: string }>;
}) => Promise<{ action: "extend" | "stop" | "move_start"; atSeconds: number | null }>;

export function cuesInWindow(
  cues: SpanReviewCue[],
  fromExclusiveSeconds: number,
  toInclusiveSeconds: number,
): SpanReviewCue[] {
  return cues.filter(
    (cue) => cue.startSeconds > fromExclusiveSeconds && cue.startSeconds <= toInclusiveSeconds,
  );
}

export function cuesInClosedWindow(
  cues: SpanReviewCue[],
  fromSeconds: number,
  toSeconds: number,
): SpanReviewCue[] {
  return cues.filter((cue) => cue.startSeconds >= fromSeconds && cue.startSeconds < toSeconds);
}

function topicKey(topic: SpanReviewTopic): string {
  return (topic.itemNumber || topic.title).trim().toLowerCase();
}

export function isOutlineLeafTopic(topic: SpanReviewTopic, all: SpanReviewTopic[]): boolean {
  const code = topic.itemNumber?.trim();
  if (!code) return true;
  const normalized = code.toLowerCase();
  return !all.some((other) => parentAgendaItemCode(other.itemNumber)?.toLowerCase() === normalized);
}

export function topicClockSpans(topic: SpanReviewTopic): TimestampRange[] {
  return parseDiscussionTimestampRanges(topic.discussionTimestampRange);
}

function allLeafSpans(
  topics: SpanReviewTopic[],
): Array<{ key: string; title: string; startSeconds: number; endSeconds: number }> {
  const leaves = topics.filter((topic) => isOutlineLeafTopic(topic, topics));
  return leaves.flatMap((topic) =>
    topicClockSpans(topic).map((span) => ({
      key: topicKey(topic),
      title: topic.title,
      itemNumber: topic.itemNumber,
      startSeconds: span.startSeconds,
      endSeconds: span.endSeconds,
    })),
  );
}

export function nextForeignSpanStartSeconds(
  topic: SpanReviewTopic,
  afterSeconds: number,
  topics: SpanReviewTopic[],
): { startSeconds: number; title: string } | null {
  const key = topicKey(topic);
  const later = allLeafSpans(topics)
    .filter((span) => span.key !== key && span.startSeconds > afterSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const next = later[0];
  if (!next) return null;
  return {
    startSeconds: next.startSeconds,
    title: next.title,
    itemNumber: next.itemNumber,
  };
}

export function listUnmatchedLaterLeaves(
  topic: SpanReviewTopic,
  afterSeconds: number,
  topics: SpanReviewTopic[],
): SpanReviewTopic[] {
  const foreign = nextForeignSpanStartSeconds(topic, afterSeconds, topics);
  return topics.filter((candidate) => {
    if (!isOutlineLeafTopic(candidate, topics)) return false;
    if (topicKey(candidate) === topicKey(topic)) return false;
    if (topicClockSpans(candidate).length > 0) return false;
    if (compareAgendaItemCodes(topic.itemNumber, candidate.itemNumber) >= 0) return false;
    if (
      foreign?.itemNumber &&
      compareAgendaItemCodes(candidate.itemNumber, foreign.itemNumber) >= 0
    ) {
      return false;
    }
    return true;
  });
}

function attachSequencesForClockRange(
  topic: SpanReviewTopic,
  cues: SpanReviewCue[],
  startSeconds: number,
  endSeconds: number,
): Array<[number, number]> {
  const sequences = cues
    .filter((cue) => cue.startSeconds >= startSeconds && cue.startSeconds <= endSeconds)
    .map((cue) => cue.sequence);
  if (sequences.length === 0) return topic.sourceTranscriptRanges;
  const min = Math.min(...sequences);
  const max = Math.max(...sequences);
  return mergeClosedIntervals([...topic.sourceTranscriptRanges, [min, max]]);
}

export function applyTopicClockSpans(
  topic: SpanReviewTopic,
  spans: TimestampRange[],
  cues: SpanReviewCue[],
): SpanReviewTopic {
  const merged = formatDiscussionTimestampRanges(spans);
  if (spans.length === 0) {
    return { ...topic, discussionTimestampRange: merged };
  }
  let ranges: Array<[number, number]> = [];
  for (const span of spans) {
    ranges = attachSequencesForClockRange(
      { ...topic, sourceTranscriptRanges: ranges },
      cues,
      span.startSeconds,
      span.endSeconds,
    );
  }
  return {
    ...topic,
    discussionTimestampRange: merged,
    sourceTranscriptRanges: ranges.length > 0 ? ranges : topic.sourceTranscriptRanges,
  };
}

export function growSpanForwardOnce(options: {
  span: TimestampRange;
  windowSeconds?: number;
  foreignStartSeconds: number | null;
  decision: { action: "extend" | "stop"; atSeconds: number | null };
  lastCueEndSeconds: number | null;
}): TimestampRange | null {
  const windowSeconds = options.windowSeconds ?? SPAN_EDGE_WINDOW_SECONDS;
  if (options.decision.action === "stop") return null;
  const windowCap = options.span.endSeconds + windowSeconds;
  const foreignCap = options.foreignStartSeconds ?? Number.POSITIVE_INFINITY;
  const decided =
    options.decision.atSeconds ?? options.lastCueEndSeconds ?? options.span.endSeconds;
  const nextEnd = Math.min(decided, windowCap, foreignCap - 0.01);
  if (!(nextEnd > options.span.endSeconds + 0.5)) return null;
  return { startSeconds: options.span.startSeconds, endSeconds: nextEnd };
}

const SPAN_EDGE_SYSTEM_PROMPT = `You are reviewing the start or end of one condominium board agenda item's transcript range.

Walk the supplied cues in clock order. Each cue is:
1. OPEN — first substantive introduction of a different named matter
2. ENRICH — facts about the current item
3. CHANGE LIFECYCLE — assent, unmute, "move on", clerk tags about the current item

Assent ratifies the current item. It does not open the next outline item.
"Can we move to the next item?", unmute, "are you muted?", and "can you hear me?" are CHANGE LIFECYCLE of the current item. They are not OPEN. OPEN only when speakers name a different matter (project, asset, quote, contractor, unit).

Return JSON only.`;

function formatCuesForPrompt(cues: SpanReviewCue[]): string {
  return cues
    .map(
      (cue) =>
        `${cue.startTimestamp} seq=${cue.sequence} ${cue.speaker.trim() || "Unknown"}: ${cue.text}`,
    )
    .join("\n");
}

function parseJudgeJson(text: string): { action: "extend" | "stop" | "move_start"; atSeconds: number | null } {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return { action: "stop", atSeconds: null };
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const action =
      parsed.action === "extend" || parsed.action === "move_start" || parsed.action === "stop"
        ? parsed.action
        : "stop";
    const stamp =
      typeof parsed.endTimestamp === "string"
        ? parsed.endTimestamp
        : typeof parsed.startTimestamp === "string"
          ? parsed.startTimestamp
          : typeof parsed.atTimestamp === "string"
            ? parsed.atTimestamp
            : null;
    return { action, atSeconds: parseClockToSeconds(stamp) };
  } catch {
    return { action: "stop", atSeconds: null };
  }
}

export async function defaultSpanEdgeJudge(input: {
  topic: SpanReviewTopic;
  direction: "forward" | "backward" | "trim_start";
  windowStartSeconds: number;
  windowEndSeconds: number;
  cues: SpanReviewCue[];
  nextForeignTitle: string | null;
  unmatchedLaterLeaves: Array<{ itemNumber?: string; title: string }>;
}): Promise<{ action: "extend" | "stop" | "move_start"; atSeconds: number | null }> {
  const code = input.topic.itemNumber ? `${input.topic.itemNumber} — ` : "";
  const foreign = input.nextForeignTitle
    ? `The next extracted item nearby is "${input.nextForeignTitle}". Do not start that item on assent or wrap-up of the current item.`
    : "No later extracted item is in this window.";
  const unmatched =
    input.unmatchedLaterLeaves.length > 0
      ? `Package leaves with no transcript range yet, later in the outline: ${input.unmatchedLaterLeaves
          .map((leaf) => `${leaf.itemNumber ?? "?"} — ${leaf.title}`)
          .join("; ")}. If this window names one of them (different unit, project, or heading), return stop so they can be assigned. Extend only wrap-up of the CURRENT item.`
      : "No unmatched later package leaves sit between this item and the next ranged leaf.";
  const userText =
    input.direction === "forward"
      ? `CURRENT ITEM: ${code}${input.topic.title}

These cues start after the current span end (${formatClockFromSeconds(input.windowStartSeconds)}) and run through ${formatClockFromSeconds(input.windowEndSeconds)}.

${foreign}

${unmatched}

If they still belong to the current item (enrich or lifecycle wrap-up, including "move to the next item" and unmute without naming the next matter), return:
{"action":"extend","endTimestamp":"HH:MM:SS"}
using the last cue that still belongs to this item.

If a different matter is named (OPEN), including an unmatched later package leaf, return:
{"action":"stop"}

CUES:
${formatCuesForPrompt(input.cues)}`
      : input.direction === "trim_start"
        ? `CURRENT ITEM: ${code}${input.topic.title}

The span currently starts at ${formatClockFromSeconds(input.windowStartSeconds)}. These cues are the first two minutes of that span.

${foreign}

If early cues are still the previous item (assent, unmute, wrap-up, clerk tags) and THIS item is named later in the window, return:
{"action":"move_start","startTimestamp":"HH:MM:SS"}
at the first cue that introduces this item.

If the span already starts on this item, return:
{"action":"stop"}

CUES:
${formatCuesForPrompt(input.cues)}`
      : `CURRENT ITEM: ${code}${input.topic.title}

These cues sit immediately BEFORE the current span start (${formatClockFromSeconds(input.windowEndSeconds)}).

${foreign}

If they already belong to THIS item (discussion already opened), return:
{"action":"move_start","startTimestamp":"HH:MM:SS"}
with the earliest cue that belongs here.

If they belong to the previous item (assent / wrap-up / unmute), return:
{"action":"stop"}

CUES:
${formatCuesForPrompt(input.cues)}`;

  const response = await generateDeepSeekJson({
    systemInstruction: SPAN_EDGE_SYSTEM_PROMPT,
    userText,
    modelName: "deepseek-v4-flash",
    maxOutputTokens: 512,
    temperature: 0,
    thinking: false,
  });
  return parseJudgeJson(response.text);
}

async function growOneSpan(options: {
  topic: SpanReviewTopic;
  span: TimestampRange;
  topics: SpanReviewTopic[];
  cues: SpanReviewCue[];
  judge: SpanEdgeJudge;
}): Promise<TimestampRange> {
  let span = options.span;
  for (let loop = 0; loop < SPAN_EDGE_MAX_FORWARD_LOOPS; loop += 1) {
    const foreign = nextForeignSpanStartSeconds(options.topic, span.endSeconds, options.topics);
    const windowEnd = Math.min(
      span.endSeconds + SPAN_EDGE_WINDOW_SECONDS,
      foreign?.startSeconds ?? Number.POSITIVE_INFINITY,
    );
    const windowCues = cuesInWindow(options.cues, span.endSeconds, windowEnd);
    if (windowCues.length === 0) break;
    const unmatched = listUnmatchedLaterLeaves(
      options.topic,
      span.endSeconds,
      options.topics,
    );
    const decision = await options.judge({
      topic: options.topic,
      direction: "forward",
      windowStartSeconds: span.endSeconds,
      windowEndSeconds: windowEnd,
      cues: windowCues,
      nextForeignTitle: foreign?.title ?? null,
      unmatchedLaterLeaves: unmatched.map((leaf) => ({
        itemNumber: leaf.itemNumber,
        title: leaf.title,
      })),
    });
    const lastCue = windowCues[windowCues.length - 1];
    const grown = growSpanForwardOnce({
      span,
      foreignStartSeconds: foreign?.startSeconds ?? null,
      decision: {
        action: decision.action === "extend" ? "extend" : "stop",
        atSeconds: decision.atSeconds,
      },
      lastCueEndSeconds: lastCue.endSeconds || lastCue.startSeconds,
    });
    if (!grown) break;
    span = grown;
  }
  return span;
}

async function nudgeSpanStart(options: {
  topic: SpanReviewTopic;
  span: TimestampRange;
  topics: SpanReviewTopic[];
  cues: SpanReviewCue[];
  judge: SpanEdgeJudge;
}): Promise<TimestampRange> {
  const floor = Math.max(0, options.span.startSeconds - SPAN_EDGE_BACK_WINDOW_SECONDS);
  const previousSame = topicClockSpans(options.topic)
    .filter((span) => span.endSeconds < options.span.startSeconds)
    .sort((left, right) => right.endSeconds - left.endSeconds)[0];
  const from = Math.max(floor, previousSame ? previousSame.endSeconds : floor);
  const windowCues = cuesInClosedWindow(options.cues, from, options.span.startSeconds);
  if (windowCues.length === 0) return options.span;
  const foreign = nextForeignSpanStartSeconds(options.topic, options.span.startSeconds, options.topics);
  const decision = await options.judge({
    topic: options.topic,
    direction: "backward",
    windowStartSeconds: from,
    windowEndSeconds: options.span.startSeconds,
    cues: windowCues,
    nextForeignTitle: foreign?.title ?? null,
    unmatchedLaterLeaves: [],
  });
  if (decision.action !== "move_start") {
    return options.span;
  }
  const at = decision.atSeconds;
  if (at === null || at >= options.span.startSeconds || at < from) return options.span;
  return { startSeconds: at, endSeconds: options.span.endSeconds };
}

async function trimSpanStart(options: {
  topic: SpanReviewTopic;
  span: TimestampRange;
  topics: SpanReviewTopic[];
  cues: SpanReviewCue[];
  judge: SpanEdgeJudge;
}): Promise<TimestampRange> {
  const windowEnd = Math.min(
    options.span.endSeconds,
    options.span.startSeconds + SPAN_EDGE_WINDOW_SECONDS,
  );
  const windowCues = cuesInClosedWindow(options.cues, options.span.startSeconds, windowEnd);
  if (windowCues.length === 0) return options.span;
  const foreign = nextForeignSpanStartSeconds(options.topic, options.span.startSeconds, options.topics);
  const decision = await options.judge({
    topic: options.topic,
    direction: "trim_start",
    windowStartSeconds: options.span.startSeconds,
    windowEndSeconds: windowEnd,
    cues: windowCues,
    nextForeignTitle: foreign?.title ?? null,
    unmatchedLaterLeaves: [],
  });
  if (decision.action !== "move_start" || decision.atSeconds === null) return options.span;
  const at = decision.atSeconds;
  if (at <= options.span.startSeconds + 0.5 || at >= options.span.endSeconds) return options.span;
  return { startSeconds: at, endSeconds: options.span.endSeconds };
}

export async function reviewTranscriptTopicSpans(options: {
  topics: SpanReviewTopic[];
  cues: SpanReviewCue[];
  judge?: SpanEdgeJudge;
  onProgress?: (label: string) => Promise<void> | void;
}): Promise<SpanReviewTopic[]> {
  const judge = options.judge ?? defaultSpanEdgeJudge;
  let topics = options.topics.map((topic) => ({ ...topic }));
  const leaves = () =>
    topics
      .map((topic, index) => ({ topic, index }))
      .filter(({ topic }) => isOutlineLeafTopic(topic, topics) && topicClockSpans(topic).length > 0)
      .sort((left, right) => {
        const leftStart = topicClockSpans(left.topic)[0]?.startSeconds ?? 0;
        const rightStart = topicClockSpans(right.topic)[0]?.startSeconds ?? 0;
        return leftStart - rightStart;
      });

  for (let round = 0; round < SPAN_EDGE_MAX_ROUNDS; round += 1) {
    await options.onProgress?.(`Reviewing transcript span edges (round ${round + 1})`);
    for (const { topic, index } of leaves()) {
      const spans = topicClockSpans(topic);
      const grown: TimestampRange[] = [];
      for (const span of spans) {
        grown.push(
          await growOneSpan({
            topic,
            span,
            topics,
            cues: options.cues,
            judge,
          }),
        );
      }
      topics[index] = applyTopicClockSpans(topic, grown, options.cues);
    }

    for (const { topic, index } of [...leaves()].reverse()) {
      const spans = topicClockSpans(topic);
      const adjusted: TimestampRange[] = [];
      for (const span of spans) {
        const trimmed = await trimSpanStart({
          topic,
          span,
          topics,
          cues: options.cues,
          judge,
        });
        adjusted.push(
          await nudgeSpanStart({
            topic,
            span: trimmed,
            topics,
            cues: options.cues,
            judge,
          }),
        );
      }
      topics[index] = applyTopicClockSpans(topic, adjusted, options.cues);
    }
  }

  return topics;
}

export function transcriptSegmentsToReviewCues(
  segments: Array<{
    sequence: number;
    startMs: number;
    endMs: number;
    startTimestamp: string;
    speakerLabel: string | null;
    text: string;
  }>,
): SpanReviewCue[] {
  return [...segments]
    .sort((left, right) => left.sequence - right.sequence)
    .map((segment) => ({
      sequence: segment.sequence,
      startSeconds: segment.startMs / 1000,
      endSeconds: segment.endMs / 1000,
      startTimestamp: segment.startTimestamp,
      speaker: segment.speakerLabel ?? "",
      text: segment.text,
    }));
}
