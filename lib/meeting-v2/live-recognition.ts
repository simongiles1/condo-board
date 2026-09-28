/**
 * Original live-room speech cues. These rows are not a transcript artifact.
 */

export const LIVE_RECOGNITION_MAX_CHARS = 2000;
const DUPLICATE_WINDOW_MS = 2000;

export type LiveRecognitionCueView = {
  id: string;
  startOffsetMs: number;
  endOffsetMs: number;
  speakerIdentity: string;
  speakerLabel: string;
  text: string;
  agendaItemId: string | null;
  corrections: LiveRecognitionCorrectionView[];
};

export type LiveRecognitionCorrectionView = {
  id: string;
  cueId: string;
  heardText: string;
  proposedText: string;
  source: "vocabulary" | "manual";
  status: "proposed" | "accepted" | "rejected";
  createdByIdentity: string;
  decidedByIdentity: string | null;
};

/**
 * Trims a finalized utterance. Returns null when there is nothing to store.
 */
export function normalizeRecognitionText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= LIVE_RECOGNITION_MAX_CHARS) return normalized;
  return normalized.slice(0, LIVE_RECOGNITION_MAX_CHARS).trimEnd();
}

/**
 * Places a just-finished utterance on the media clock, ending at `endOffsetMs`.
 */
export function recognitionCueOffsets(input: {
  endOffsetMs: number;
  durationMs: number;
}): { startOffsetMs: number; endOffsetMs: number } {
  const endOffsetMs = Math.max(0, Math.floor(input.endOffsetMs));
  const duration = Number.isFinite(input.durationMs)
    ? Math.min(60_000, Math.max(200, Math.round(input.durationMs)))
    : 1500;
  return {
    startOffsetMs: Math.max(0, endOffsetMs - duration),
    endOffsetMs,
  };
}

/**
 * True when the browser just sent the same utterance again.
 */
export function isDuplicateRecognitionCue(input: {
  previous: { speakerIdentity: string; text: string; startOffsetMs: number } | null;
  next: { speakerIdentity: string; text: string; startOffsetMs: number };
}): boolean {
  const previous = input.previous;
  if (!previous) return false;
  return (
    previous.speakerIdentity === input.next.speakerIdentity &&
    previous.text === input.next.text &&
    Math.abs(previous.startOffsetMs - input.next.startOffsetMs) <= DUPLICATE_WINDOW_MS
  );
}
