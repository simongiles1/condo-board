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
  /** Package words that name what the discussion pointed at. They are not the decision. */
  packageQuote?: string | null;
  /** The talk points at a package fact this item does not have. */
  openReference?: boolean;
};

const STATUS_SET = new Set<string>(MEETINGS_V3_CONCLUSION_STATUSES);
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";

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
 * Reads this meeting's outcome from the stretch, sentence by sentence.
 * A later sentence replaces an earlier one. A motion, a negation, a defeat, and a past approval do not count as ratification.
 * Empty talk stays unclear. Talk without a decision stays discussed.
 */
export function concludeFromDiscussion(discussion: string): MeetingsV3ItemConclusion {
  const text = discussion.replace(/\s+/g, " ").trim();
  if (!text) return { status: "unclear", discussion: "", quote: null, packageQuote: null, openReference: false };
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  let status: MeetingsV3ConclusionStatus = "discussed";
  let quote: string | null = null;
  let settled = false;
  for (const sentence of sentences) {
    const effect = sentenceEffect(sentence);
    if (effect === "adopt") {
      status = "ratified";
      quote = sentence;
      settled = true;
    } else if (effect === "defer") {
      status = "deferred";
      quote = sentence;
      settled = true;
    } else if (effect === "defeat") {
      status = "discussed";
      quote = sentence;
      settled = true;
    } else if (effect === "motion" && !settled) {
      status = "discussed";
      quote = sentence;
    }
  }
  return { status, discussion: text, quote, packageQuote: null, openReference: false };
}

/**
 * Attaches a package quote when the discussion points at a recommendation or option.
 * The package quote does not change the meeting status. A pointer with no matching fact stays open.
 */
export function applyPackageReference(
  conclusion: MeetingsV3ItemConclusion,
  facts: readonly { quote?: string | null; role?: string | null }[],
): MeetingsV3ItemConclusion {
  if (!pointsAtPackage(conclusion.discussion)) {
    return { ...conclusion, packageQuote: null, openReference: false };
  }
  const match = facts.find((fact) => fact.role === "recommendation" && fact.quote?.trim());
  if (!match?.quote) return { ...conclusion, packageQuote: null, openReference: true };
  return { ...conclusion, packageQuote: match.quote.replace(/\s+/g, " ").trim(), openReference: false };
}

type SentenceEffect = "adopt" | "defer" | "defeat" | "motion" | "none";

function sentenceEffect(sentence: string): SentenceEffect {
  if (isPriorReference(sentence)) return "none";
  if (isDefeat(sentence) || isNegatedAdoption(sentence)) return "defeat";
  if (isDeferral(sentence) && !isNegatedDeferral(sentence) && !isHypothetical(sentence, "defer")) return "defer";
  if (isMotion(sentence) && !isRecordedAdoption(sentence)) return "motion";
  if (isHypothetical(sentence, "adopt")) return "none";
  if (isRecordedAdoption(sentence) || isAdoption(sentence)) return "adopt";
  return "none";
}

function isPriorReference(sentence: string): boolean {
  const reportsPast = new RegExp(
    `\\b(was approved|approved by email|already approved|previously approved|last meeting|prior meeting|the package says|in (${MONTHS}))\\b`,
    "i",
  ).test(sentence);
  return reportsPast && !isRecordedAdoption(sentence) && !isMotion(sentence);
}

function isDefeat(sentence: string): boolean {
  return /\b(defeated|voted down|withdrawn)\b/i.test(sentence) || /\bmotion (failed|lost)\b/i.test(sentence);
}

function isNegatedAdoption(sentence: string): boolean {
  return /\b(did not|didn't|do not|don't|never|was not|wasn't)\b(?:\s+\w+){0,6}\b(ratif\w*|approv\w*|adopt\w*|carr\w*|defer\w*)\b/i.test(sentence);
}

function isNegatedDeferral(sentence: string): boolean {
  return /\b(did not|didn't|do not|don't|was not|wasn't)\b(?:\s+\w+){0,6}\b(defer\w*|table\w*|postpone\w*)\b/i.test(sentence);
}

function isDeferral(sentence: string): boolean {
  return /\b(defer(?:red)?|tabled|postponed)\b/i.test(sentence);
}

function isMotion(sentence: string): boolean {
  return /\b(so moved|i move|i so move|moved and seconded)\b/i.test(sentence);
}

function isRecordedAdoption(sentence: string): boolean {
  return /\b(carried|unanimously|motion passed|was adopted|were adopted)\b/i.test(sentence)
    || /\b(is|was|were|been)\s+ratified\b/i.test(sentence);
}

function isAdoption(sentence: string): boolean {
  if (/\bwe ratify\b/i.test(sentence)) return true;
  if (/\b(board|meeting)\s+approved\b/i.test(sentence)) return true;
  if (/\bapproved the\b/i.test(sentence)) return true;
  if (/\b(proceed with|resolved to|agreed to)\b/i.test(sentence)) return true;
  return false;
}

function isHypothetical(sentence: string, kind: "adopt" | "defer"): boolean {
  const verb = kind === "defer" ? "defer\\w*|table\\w*|postpone\\w*" : "ratif\\w*|approv\\w*|adopt\\w*|proceed\\w*";
  return new RegExp(`\\b(can|could|might|may)\\b(?:\\s+\\w+){0,4}\\s+(${verb})\\b`, "i").test(sentence)
    || (/\blater\b/i.test(sentence) && new RegExp(`\\b(${verb})\\b`, "i").test(sentence) && kind === "adopt");
}

function pointsAtPackage(discussion: string): boolean {
  return /\b(recommended option|engineer'?s recommendation|as recommended|proceed with the)\b/i.test(discussion);
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
  const record = parsed as {
    status?: unknown;
    discussion?: unknown;
    quote?: unknown;
    packageQuote?: unknown;
    openReference?: unknown;
  };
  if (typeof record.status !== "string" || !STATUS_SET.has(record.status)) return null;
  if (typeof record.discussion !== "string") return null;
  const discussion = record.discussion.replace(/\s+/g, " ").trim();
  const quote = typeof record.quote === "string" ? record.quote.replace(/\s+/g, " ").trim() : "";
  const packageQuote = typeof record.packageQuote === "string" ? record.packageQuote.replace(/\s+/g, " ").trim() : "";
  const openReference = record.openReference === true;
  if (quote && !discussion.toLowerCase().includes(quote.toLowerCase())) {
    return {
      status: record.status as MeetingsV3ConclusionStatus,
      discussion,
      quote: null,
      packageQuote: packageQuote || null,
      openReference,
    };
  }
  return {
    status: record.status as MeetingsV3ConclusionStatus,
    discussion,
    quote: quote || null,
    packageQuote: packageQuote || null,
    openReference,
  };
}
