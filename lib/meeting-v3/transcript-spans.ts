/**
 * Accepts a transcript span only when its quote is inside that cue window.
 * Cues are not merged by speaker. Two topics that claim the same stretch both stay.
 */

import { parseVttCues, parseVttTimestampMs } from "@/lib/parsers/vtt";

import { normalizeFactText } from "@/lib/meeting-v3/facts";

/** Cues sent in one segmentation call. */
export const TRANSCRIPT_CUE_BATCH = 40;

/**
 * Output budget for one segmentation call.
 * A long stretch list is split and tried again when the reply is cut off.
 */
export const TRANSCRIPT_SEGMENT_MAX_OUTPUT_TOKENS = 8192;

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

/** A model span before it is checked against the cues. */
export type MeetingsV3ProposedSpan = {
  agendaItemId?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  quote?: unknown;
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
 * Splits cues so one reply can name every stretch in that slice.
 * An empty list stays empty.
 */
export function chunkTranscriptCues<T>(cues: readonly T[], size = TRANSCRIPT_CUE_BATCH): T[][] {
  if (size < 1) {
    throw new Error("Transcript cue batch size must be at least 1.");
  }
  const chunks: T[][] = [];
  for (let offset = 0; offset < cues.length; offset += size) {
    chunks.push(cues.slice(offset, offset + size));
  }
  return chunks;
}

/**
 * Keeps proposed spans whose quote is inside a window that starts and ends on cue boundaries.
 * Abutting or overlapping spans for the same item become one span.
 * A window claimed by two items is marked on both spans.
 */
export function acceptQuotedSpans(input: {
  cues: MeetingsV3TranscriptCue[];
  proposed: MeetingsV3ProposedSpan[];
  agendaItemIds: ReadonlySet<string>;
}): Map<string, MeetingsV3ItemTranscript> {
  const cues = [...input.cues].sort((left, right) => left.startMs - right.startMs || left.index - right.index);
  const collected = new Map<string, MeetingsV3TranscriptSpan[]>();
  const seen = new Set<string>();

  for (const proposed of input.proposed) {
    if (typeof proposed.agendaItemId !== "string" || !input.agendaItemIds.has(proposed.agendaItemId)) {
      continue;
    }
    const startMs = readMilliseconds(proposed.startMs);
    const endMs = readMilliseconds(proposed.endMs);
    if (startMs == null || endMs == null || endMs <= startMs) continue;
    if (typeof proposed.quote !== "string" || !proposed.quote.trim()) continue;
    const quote = proposed.quote.replace(/\s+/g, " ").trim();
    const quoteNorm = normalizeFactText(quote);
    if (!quoteNorm) continue;
    const covered = cues.filter((cue) => cue.startMs < endMs && cue.endMs > startMs);
    if (covered.length === 0) continue;
    const first = covered[0];
    const last = covered[covered.length - 1];
    if (!first || !last || first.startMs !== startMs || last.endMs !== endMs) continue;
    const windowText = normalizeFactText(covered.map((cue) => cue.text).join(" "));
    if (!windowText.includes(quoteNorm)) continue;
    const key = `${proposed.agendaItemId}\0${startMs}\0${endMs}\0${quoteNorm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spans = collected.get(proposed.agendaItemId) ?? [];
    spans.push({ startMs, endMs, quote, overlaps: false });
    collected.set(proposed.agendaItemId, spans);
  }

  for (const [itemId, spans] of collected) {
    collected.set(itemId, mergeTouchingSpans(spans));
  }

  const flat = [...collected.entries()].flatMap(([itemId, spans]) =>
    spans.map((span) => ({ itemId, span })),
  );
  for (let left = 0; left < flat.length; left += 1) {
    for (let right = left + 1; right < flat.length; right += 1) {
      const a = flat[left];
      const b = flat[right];
      if (!a || !b || a.itemId === b.itemId) continue;
      if (a.span.startMs < b.span.endMs && b.span.startMs < a.span.endMs) {
        a.span.overlaps = true;
        b.span.overlaps = true;
      }
    }
  }

  return new Map(
    [...collected.entries()].map(([itemId, spans]) => [itemId, { spans }]),
  );
}

/**
 * Reads the model reply into per-item proposed spans.
 * Throws when the reply is not the expected JSON object.
 */
export function readProposedSpans(
  text: string,
): Array<{ agendaItemId: string; spans: MeetingsV3ProposedSpan[] }> {
  const parsed = JSON.parse(text) as { items?: unknown };
  if (!Array.isArray(parsed.items)) {
    throw new Error("Transcript segmentation response did not include items.");
  }
  return parsed.items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { agendaItemId?: unknown; spans?: unknown };
    if (typeof record.agendaItemId !== "string" || !Array.isArray(record.spans)) return [];
    const spans = record.spans.filter(
      (span): span is MeetingsV3ProposedSpan => span != null && typeof span === "object",
    );
    return [{ agendaItemId: record.agendaItemId, spans }];
  });
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

function readMilliseconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    return Number.isFinite(asNumber) ? Math.round(asNumber) : null;
  }
  if (!trimmed.includes(":")) return null;
  const parsed = parseVttTimestampMs(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
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
