import type { MergedVttCue } from "@/lib/parsers/vtt";

export type RecordingEgressStatus =
  | "starting"
  | "active"
  | "ending"
  | "complete"
  | "failed"
  | "aborted"
  | "limit";

export type RecordingEgressSnapshot = {
  status: RecordingEgressStatus;
  error: string;
};

export type RecordingHealthState =
  | "unconfigured"
  | "waiting"
  | "recording"
  | "failed"
  | "finished"
  | "unknown";

export type RecordingHealth = {
  state: RecordingHealthState;
  label: string;
  detail: string;
};

export type LiveRecognitionCue = {
  startMs: number;
  endMs: number;
  speakerLabel: string;
  text: string;
};

/**
 * Why live recognition is not written into `meetings_v2_transcript_segments` yet.
 * The cue shape already matches. Inserting it would change which transcript the minutes pipeline reads.
 */
export const LIVE_TRANSCRIPT_INSERT_GAP =
  "Live cues use the same start, end, speaker, and text shape as meetings_v2_transcript_segments, and parseVttToMergedCues already accepts that VTT. Rows are not inserted because each segment requires the meeting's transcript source artifact, and the minutes pipeline uses the first artifact of type transcript. A second live artifact would be read as the historical transcript. No recognizer is connected, so there is nothing to store.";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

/**
 * Formats a media-clock offset as a WebVTT timestamp.
 */
export function formatMediaClock(offsetMs: number): string {
  const ms = Math.max(0, Math.floor(offsetMs));
  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((ms % MS_PER_MINUTE) / 1000);
  const millis = ms % 1000;
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/**
 * Elapsed milliseconds from the room media origin.
 * Throws if `mediaStartedAt` is not a parseable timestamp.
 */
export function mediaOffsetMs(mediaStartedAt: string, at: Date): number {
  const start = Date.parse(mediaStartedAt);
  if (!Number.isFinite(start)) {
    throw new Error("mediaStartedAt is not a timestamp.");
  }
  return Math.max(0, at.getTime() - start);
}

/**
 * Collapses LiveKit egress rows into the recording state shown in the room.
 */
export function summarizeRecordingHealth(
  rows: RecordingEgressSnapshot[],
): RecordingHealth {
  if (rows.length === 0) {
    return {
      state: "waiting",
      label: "Waiting",
      detail: "No track recording has started. It begins when someone publishes audio.",
    };
  }

  const inProgress = rows.filter(
    (row) =>
      row.status === "starting" || row.status === "active" || row.status === "ending",
  );
  if (inProgress.length > 0) {
    const countLabel =
      inProgress.length === 1 ? "1 track recording" : `${inProgress.length} track recordings`;
    return {
      state: "recording",
      label: "Recording",
      detail: `${countLabel} in progress.`,
    };
  }

  const failed = rows.filter(
    (row) => row.status === "failed" || row.status === "aborted" || row.status === "limit",
  );
  if (failed.length > 0) {
    return {
      state: "failed",
      label: "Recording failed",
      detail: failed.find((row) => row.error.trim())?.error.trim()
        || `${failed.length} track recording${failed.length === 1 ? "" : "s"} failed.`,
    };
  }

  if (rows.every((row) => row.status === "complete")) {
    return {
      state: "finished",
      label: "Recording finished",
      detail:
        rows.length === 1
          ? "1 track file completed."
          : `${rows.length} track files completed.`,
    };
  }

  return {
    state: "unknown",
    label: "Unknown",
    detail: "Recording status could not be read.",
  };
}

/**
 * Recording state when LiveKit credentials are absent.
 */
export function unconfiguredRecordingHealth(): RecordingHealth {
  return {
    state: "unconfigured",
    label: "Not configured",
    detail: "Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET to join a room.",
  };
}

/**
 * Recording state when the room can open but Cloud has nowhere to store track files.
 */
export function missingStorageRecordingHealth(): RecordingHealth {
  return {
    state: "unconfigured",
    label: "Not recording",
    detail:
      "The room can open, but LiveKit Cloud will not record until LIVEKIT_EGRESS_S3_BUCKET, LIVEKIT_EGRESS_S3_ACCESS_KEY, and LIVEKIT_EGRESS_S3_SECRET are set. A room created before that stays without recording until everyone leaves and it is opened again.",
  };
}

/**
 * Maps live recognition cues onto the VTT cue shape the minutes pipeline already parses.
 * Does not insert rows. See `LIVE_TRANSCRIPT_INSERT_GAP`.
 */
export function liveCuesToMergedCues(cues: LiveRecognitionCue[]): MergedVttCue[] {
  return cues.map((cue) => ({
    start: formatMediaClock(cue.startMs),
    end: formatMediaClock(cue.endMs),
    speaker: cue.speakerLabel,
    text: cue.text,
  }));
}
