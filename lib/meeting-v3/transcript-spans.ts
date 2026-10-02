/**
 * Turns a segmented topic list into transcript spans for the V3 agenda.
 * Cues are not merged by speaker. A heading takes no span of its own.
 * Two different topics that claim the same stretch both stay.
 */

import {
  compareAgendaItemCodes,
  inferPropertyManagementReportNumber,
  isAgendaItemLeaf,
  occupiesAdHocSection,
  parseDiscussionTimestampRanges,
} from "@/lib/meeting-v2/agenda-outline";
import { parseVttCues, parseVttTimestampMs } from "@/lib/parsers/vtt";

/** One transcript cue, with times in milliseconds. */
export type MeetingsV3TranscriptCue = {
  index: number;
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
};

/** A stretch of talk kept for one agenda item. */
export type MeetingsV3TranscriptSpan = {
  startMs: number;
  endMs: number;
  quote: string;
  overlaps: boolean;
};

/** Spans kept for one agenda item. */
export type MeetingsV3ItemTranscript = {
  spans: MeetingsV3TranscriptSpan[];
};

/** One topic after the V2 walk, with the clock range that walk stored. */
export type SegmentedTopicTiming = {
  itemNumber?: string | null;
  title: string;
  sectionLabel?: string | null;
  itemType?: string | null;
  discussionTimestampRange?: string | null;
};

/** Spans for one outline code, ready to store on a V3 agenda row. */
export type SegmentedTopicSpanRow = {
  itemNumber: string;
  title: string;
  sectionLabel: string;
  itemType: string;
  transcript: MeetingsV3ItemTranscript;
};

/**
 * Reads a VTT into separate cues.
 * Adjacent cues from the same speaker stay separate so a turn change can start a new topic.
 */
export function cuesFromVtt(vtt: string): MeetingsV3TranscriptCue[] {
  return parseVttCues(vtt).flatMap((cue, index) => {
    const startMs = Math.round(parseVttTimestampMs(cue.start));
    const endMs = Math.round(parseVttTimestampMs(cue.end));
    const text = cue.text.replace(/\s+/g, " ").trim();
    if (!text || endMs <= startMs) return [];
    return [{ index, startMs, endMs, speaker: cue.speaker, text }];
  });
}

/**
 * Builds one row per outline code from the segmented topics.
 * A heading's clock range is the union of its children, so only leaves keep spans.
 * Abutting spans for the same leaf become one span. A stretch claimed by two leaves is marked on both.
 */
export function rowsFromSegmentedTopics(input: {
  topics: readonly SegmentedTopicTiming[];
  cues: readonly MeetingsV3TranscriptCue[];
}): SegmentedTopicSpanRow[] {
  const numbered = input.topics.flatMap((topic) => {
    const itemNumber = topic.itemNumber?.trim() ?? "";
    return itemNumber ? [{ ...topic, itemNumber }] : [];
  });
  const itemNumbers = numbered.map((topic) => topic.itemNumber);
  const cues = [...input.cues].sort((left, right) => left.startMs - right.startMs || left.index - right.index);
  const byNumber = new Map<string, SegmentedTopicSpanRow>();

  for (const topic of numbered) {
    const key = topic.itemNumber.toLowerCase();
    const existing = byNumber.get(key);
    const leaf = isAgendaItemLeaf(topic.itemNumber, itemNumbers);
    const spans = leaf ? spansForTopic(topic.discussionTimestampRange, cues) : [];
    if (!existing) {
      byNumber.set(key, {
        itemNumber: topic.itemNumber,
        title: topic.title.trim() || topic.itemNumber,
        sectionLabel: topic.sectionLabel?.trim() || topic.title.trim() || topic.itemNumber,
        itemType: topic.itemType?.trim() || "other",
        transcript: { spans },
      });
      continue;
    }
    existing.transcript = { spans: mergeTouchingSpans([...existing.transcript.spans, ...spans]) };
  }

  const rows = [...byNumber.values()];
  markCrossItemOverlaps(rows);
  return rows.sort((left, right) => compareAgendaItemCodes(left.itemNumber, right.itemNumber));
}

function spansForTopic(
  timing: string | null | undefined,
  cues: readonly MeetingsV3TranscriptCue[],
): MeetingsV3TranscriptSpan[] {
  const spans: MeetingsV3TranscriptSpan[] = [];
  for (const range of parseDiscussionTimestampRanges(timing)) {
    const startMs = Math.round(range.startSeconds * 1000);
    const endMs = Math.round(range.endSeconds * 1000);
    if (endMs <= startMs) continue;
    const covered = cues.filter((cue) => cue.startMs < endMs && cue.endMs > startMs);
    const quote = covered[0]?.text.replace(/\s+/g, " ").trim() ?? "";
    if (!quote) continue;
    spans.push({ startMs, endMs, quote, overlaps: false });
  }
  return mergeTouchingSpans(spans);
}

function markCrossItemOverlaps(rows: SegmentedTopicSpanRow[]): void {
  const flat = rows.flatMap((row) => row.transcript.spans.map((span) => ({ itemNumber: row.itemNumber, span })));
  for (let left = 0; left < flat.length; left += 1) {
    for (let right = left + 1; right < flat.length; right += 1) {
      const a = flat[left];
      const b = flat[right];
      if (!a || !b || a.itemNumber.toLowerCase() === b.itemNumber.toLowerCase()) continue;
      if (a.span.startMs < b.span.endMs && b.span.startMs < a.span.endMs) {
        a.span.overlaps = true;
        b.span.overlaps = true;
      }
    }
  }
}

/**
 * The stored transcript object, or null when this item has not been segmented.
 */
export function readStoredItemTranscript(value: string | null | undefined): MeetingsV3ItemTranscript | null {
  if (!value?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { spans?: unknown };
  if (!Array.isArray(record.spans)) return null;
  const spans: MeetingsV3TranscriptSpan[] = [];
  for (const entry of record.spans) {
    if (!entry || typeof entry !== "object") continue;
    const span = entry as {
      startMs?: unknown;
      endMs?: unknown;
      quote?: unknown;
      overlaps?: unknown;
    };
    if (typeof span.startMs !== "number" || typeof span.endMs !== "number") continue;
    if (span.endMs <= span.startMs) continue;
    if (typeof span.quote !== "string" || !span.quote.trim()) continue;
    spans.push({
      startMs: span.startMs,
      endMs: span.endMs,
      quote: span.quote.trim(),
      overlaps: span.overlaps === true,
    });
  }
  return { spans };
}

/** Title stored on the transcript-only additional-business heading. */
export const ADDITIONAL_BUSINESS_TITLE = "Additional business";

/** An agenda row the segmenter can assign, including a 4.E slot the package did not print. */
export type AdditionalBusinessPlan<T extends { id: string; itemNumber: string; title: string }> = {
  items: T[];
  /** Outline code for additional business, such as 4.E. */
  code: string;
  /** A row that is not stored yet. Persist it when it receives a span. */
  injected: T | null;
  /** An existing row whose number was moved onto `code`. */
  renumberedId: string | null;
};

/**
 * True when a title is the meeting's additional-business heading.
 */
export function isAdditionalBusinessTitle(title: string | null | undefined): boolean {
  const normalized = (title || "")
    .trim()
    .toLowerCase()
    .replace(/[-–—_]/g, " ")
    .replace(/\s+/g, " ");
  return (
    normalized === "additional business" ||
    normalized === "ad hoc items" ||
    normalized === "any other business" ||
    normalized === "other business"
  );
}

/** Outline code for transcript-only extra business, such as 4.E. */
export function additionalBusinessSectionCode(
  items: Array<{ itemNumber?: string | null; title?: string | null }>,
): string {
  return `${inferPropertyManagementReportNumber(items) || "4"}.E`;
}

/**
 * True when the row was added from the transcript, not the printed package.
 * The property-management E slot and an additional-business heading both count.
 */
export function isTranscriptOnlyAgendaItem<T extends { itemNumber: string; title: string }>(
  item: T,
  items: readonly T[],
): boolean {
  if (isAdditionalBusinessTitle(item.title)) return true;
  return occupiesAdHocSection(item.itemNumber, additionalBusinessSectionCode(items));
}

/** Printed-package rows only. Transcript extras under 4.E are left out. */
export function packageAgendaItems<T extends { itemNumber: string; title: string }>(
  items: readonly T[],
): T[] {
  return items.filter((item) => !isTranscriptOnlyAgendaItem(item, items));
}

const WIZARD_STEPS_WITH_TRANSCRIPT_EXTRAS = new Set([
  "transcript",
  "sources",
  "conclusions",
  "validate",
  "draft",
]);

/**
 * Agenda rows for a V3 wizard step.
 * Extract, agenda, attachments, and facts hide transcript-only extras.
 * Later stages keep them, including the minutes check and the draft.
 */
export function agendaItemsForWizardStep<T extends { itemNumber: string; title: string }>(
  items: readonly T[],
  stepId: string | null | undefined,
): T[] {
  if (stepId && WIZARD_STEPS_WITH_TRANSCRIPT_EXTRAS.has(stepId)) return [...items];
  return packageAgendaItems(items);
}

/**
 * Puts additional business on the property-management E slot (4.E when that report is item 4).
 * A printed heading that already uses that code is kept. A heading titled additional business
 * under another number is moved there. Otherwise `create` supplies a new row, ordered before
 * the next meeting date.
 */
export function planAdditionalBusinessItem<T extends { id: string; itemNumber: string; title: string }>(
  items: T[],
  create: (code: string) => T,
): AdditionalBusinessPlan<T> {
  const pm = inferPropertyManagementReportNumber(items) || "4";
  const code = `${pm}.E`;
  const heading = items.find((item) => item.itemNumber.trim().toLowerCase() === code.toLowerCase());
  if (heading) {
    return { items, code, injected: null, renumberedId: null };
  }
  const titled = items.find((item) => isAdditionalBusinessTitle(item.title));
  if (titled) {
    const moved = { ...titled, itemNumber: code };
    const rest = items.filter((item) => item.id !== titled.id);
    return {
      items: orderByOutlineCode([...rest, moved]),
      code,
      injected: null,
      renumberedId: titled.id,
    };
  }
  const injected = create(code);
  return {
    items: orderByOutlineCode([...items, injected]),
    code,
    injected,
    renumberedId: null,
  };
}

function orderByOutlineCode<T extends { itemNumber: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => compareAgendaItemCodes(left.itemNumber, right.itemNumber));
}

/**
 * A clock label for a stored span, such as 00:01:05.
 */
export function formatSpanClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function mergeTouchingSpans(spans: MeetingsV3TranscriptSpan[]): MeetingsV3TranscriptSpan[] {
  const ordered = [...spans].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const merged: MeetingsV3TranscriptSpan[] = [];
  for (const span of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && span.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, span.endMs);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}
