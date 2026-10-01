/**
 * Meeting conclusions drawn only from the transcript stretches assigned to a topic.
 * A package sentence about a prior approval is not a conclusion of this meeting.
 */

import type { MeetingsV3TranscriptCue, MeetingsV3TranscriptSpan } from "@/lib/meeting-v3/transcript-spans";

/** What the assigned discussion supports. */
export const MEETINGS_V3_CONCLUSION_STATUSES = ["ratified", "deferred", "discussed", "unclear"] as const;

/** A status the discussion itself supports. */
export type MeetingsV3ConclusionStatus = (typeof MEETINGS_V3_CONCLUSION_STATUSES)[number];

/** One topic's meeting conclusion and the talk it came from. */
export type MeetingsV3ItemConclusion = {
  status: MeetingsV3ConclusionStatus;
  discussion: string;
  quote: string | null;
};

const STATUS_SET = new Set<string>(MEETINGS_V3_CONCLUSION_STATUSES);
const RATIFY = /\b(ratif(?:y|ied|ies)|carried|so moved)\b/i;
const DEFER = /\b(defer(?:red)?|tabled|postponed)\b/i;

/**
 * Joins every cue that overlaps the assigned stretches.
 * The span preview quote is not used.
 */
export function discussionTextForSpans(
  spans: readonly MeetingsV3TranscriptSpan[],
  cues: readonly MeetingsV3TranscriptCue[],
): string {
  const parts: string[] = [];
  const seen = new Set<number>();
  for (const span of spans) {
    for (const cue of cues) {
      if (cue.startMs >= span.endMs || cue.endMs <= span.startMs) continue;
      if (seen.has(cue.index)) continue;
      seen.add(cue.index);
      const text = cue.text.replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
    }
  }
  return parts.join(" ");
}

/**
 * Reads a decision only from phrases in the discussion.
 * Empty talk stays unclear. Talk without a decision phrase stays discussed.
 */
export function concludeFromDiscussion(discussion: string): MeetingsV3ItemConclusion {
  const text = discussion.replace(/\s+/g, " ").trim();
  if (!text) return { status: "unclear", discussion: "", quote: null };
  const sentences = text.split(/(?<=[.!?])\s+/);
  const ratified = sentences.find((sentence) => RATIFY.test(sentence));
  if (ratified) return { status: "ratified", discussion: text, quote: ratified };
  const deferred = sentences.find((sentence) => DEFER.test(sentence));
  if (deferred) return { status: "deferred", discussion: text, quote: deferred };
  return { status: "discussed", discussion: text, quote: null };
}

/**
 * The stored conclusion, or null when this item has not been reconciled.
 * A quote that is not inside the stored discussion is dropped.
 */
export function readStoredItemConclusion(value: string | null | undefined): MeetingsV3ItemConclusion | null {
  if (!value?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { status?: unknown; discussion?: unknown; quote?: unknown };
  if (typeof record.status !== "string" || !STATUS_SET.has(record.status)) return null;
  if (typeof record.discussion !== "string") return null;
  const discussion = record.discussion.replace(/\s+/g, " ").trim();
  const quote = typeof record.quote === "string" ? record.quote.replace(/\s+/g, " ").trim() : "";
  if (quote && !discussion.toLowerCase().includes(quote.toLowerCase())) {
    return { status: record.status as MeetingsV3ConclusionStatus, discussion, quote: null };
  }
  return {
    status: record.status as MeetingsV3ConclusionStatus,
    discussion,
    quote: quote || null,
  };
}
