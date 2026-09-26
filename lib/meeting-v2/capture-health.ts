import type {
  CaptureDetection,
  CaptureGapView,
  RecordingEgressStatus,
  RecordingHealth,
} from "@/lib/meeting-v2/live-clock";

/**
 * How long a published microphone may lack a track egress before capture is critical.
 * LiveKit status lags the moment a track is published. This starting value avoids an instant false alarm.
 * Replace it with a number measured in a live room before the board night.
 */
// CONCERN: grace is unmeasured; a live room can still false-alarm or hide a miss until this is replaced with a measured value.
export const CAPTURE_EGRESS_GRACE_MS = 20_000;

/**
 * How much shorter a stored file may be than publishing time and still count as covering it.
 */
export const CAPTURE_DURATION_TOLERANCE_MS = 3_000;

const LIVE_STATUS = new Set<RecordingEgressStatus>(["starting", "active", "ending"]);
const FAILED_STATUS = new Set<RecordingEgressStatus>(["failed", "aborted", "limit"]);

export type CaptureTrackEgress = {
  egressId: string;
  status: RecordingEgressStatus;
  error: string;
  trackId: string | null;
};

export type PublishingMicrophone = {
  participantIdentity: string;
  trackId: string;
  firstSeenAtMs: number;
};

export type StoredCaptureTrack = {
  trackId: string;
  participantIdentity: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  unpublishedAtMs: number | null;
  fileOpened: boolean;
  fileDurationMs: number | null;
  fileStartedAtMs: number | null;
};

export type CaptureHealthInput = {
  nowMs: number;
  mediaStartedAtMs: number | null;
  storageConfigured: boolean;
  statusReadOk: boolean;
  statusError: string | null;
  roomClosed: boolean;
  publishing: PublishingMicrophone[];
  egress: CaptureTrackEgress[];
  gaps: CaptureGapView[];
  tracks: StoredCaptureTrack[];
  graceMs?: number;
};

export type CaptureGapDraft = {
  detection: Exclude<CaptureDetection, "backup_accepted">;
  trackId: string | null;
  egressId: string | null;
  participantIdentity: string | null;
  startOffsetMs: number;
  detail: string;
};

export type CaptureHealthResult = {
  health: RecordingHealth;
  drafts: CaptureGapDraft[];
  closeGapIds: string[];
  clockDeltaMs: number | null;
};

type Problem = CaptureGapDraft;

/**
 * Decides whether capture is healthy from egress rows, publishing microphones, and stored gaps.
 * A connected room is not an input. Transcription is not an input.
 */
export function assessCaptureHealth(input: CaptureHealthInput): CaptureHealthResult {
  const graceMs = input.graceMs ?? CAPTURE_EGRESS_GRACE_MS;
  const problems: Problem[] = [];

  if (!input.statusReadOk) {
    problems.push({
      detection: "status_read_failed",
      trackId: null,
      egressId: null,
      participantIdentity: null,
      startOffsetMs: mediaOffset(input.mediaStartedAtMs, input.nowMs),
      detail: input.statusError?.trim()
        ? `Capture status could not be read (${input.statusError.trim()}). Stop substantive business until capture is restored or the interruption is recorded.`
        : "Capture status could not be read. Stop substantive business until capture is restored or the interruption is recorded.",
    });
  }

  if (!input.storageConfigured) {
    problems.push({
      detection: "storage_unconfigured",
      trackId: null,
      egressId: null,
      participantIdentity: null,
      startOffsetMs: mediaOffset(input.mediaStartedAtMs, input.nowMs),
      detail:
        "Capture is not healthy. LiveKit Cloud has no bucket configured, so this room has no recording. Set LIVEKIT_EGRESS_S3_BUCKET, LIVEKIT_EGRESS_S3_ACCESS_KEY, and LIVEKIT_EGRESS_S3_SECRET, then everyone must leave and open the room again. Stop substantive business until capture is restored or the interruption is recorded.",
    });
  }

  const canMatch = input.statusReadOk && input.storageConfigured;

  if (canMatch && !input.roomClosed) {
    for (const mic of input.publishing) {
      const live = liveEgressFor(input.egress, mic.trackId);
      if (live) continue;
      if (input.nowMs - mic.firstSeenAtMs <= graceMs) continue;
      problems.push({
        detection: "microphone_unmatched",
        trackId: mic.trackId,
        egressId: null,
        participantIdentity: mic.participantIdentity,
        startOffsetMs: mediaOffset(input.mediaStartedAtMs, mic.firstSeenAtMs + graceMs),
        detail: `No track recording for ${mic.participantIdentity} after the grace period. Stop substantive business until capture is restored or the interruption is recorded.`,
      });
    }
  }

  if (canMatch) {
    for (const row of input.egress) {
      if (!FAILED_STATUS.has(row.status)) continue;
      if (failureCovered(input.gaps, row.egressId)) continue;
      problems.push({
        detection: "egress_failed",
        trackId: row.trackId,
        egressId: row.egressId,
        participantIdentity: null,
        startOffsetMs: mediaOffset(input.mediaStartedAtMs, input.nowMs),
        detail: row.error.trim()
          ? `Track recording failed (${row.error.trim()}). Stop substantive business until capture is restored or the interruption is recorded.`
          : "Track recording failed. Stop substantive business until capture is restored or the interruption is recorded.",
      });
    }
  }

  if (canMatch && input.roomClosed) {
    for (const track of input.tracks) {
      problems.push(...closedRoomProblems(input, track, graceMs));
    }
  }

  const drafts = problems.filter((problem) => !openGapExists(input.gaps, problem));
  const closeGapIds = input.gaps
    .filter((gap) => gap.endOffsetMs == null && gapShouldClose(gap, input, problems, graceMs))
    .map((gap) => gap.id);

  return {
    health: healthFrom(problems, input),
    drafts,
    closeGapIds,
    clockDeltaMs: largestClockDelta(input),
  };
}

/**
 * Converts a LiveKit timestamp to milliseconds.
 * Egress times are nanoseconds. Values already in milliseconds or seconds are accepted.
 */
export function liveKitTimestampMs(value: bigint | number): number | null {
  const n = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e15) return Math.round(n / 1e6);
  if (n > 1e11) return Math.round(n);
  return Math.round(n * 1000);
}

/**
 * Reads a LiveKit track id from an egress object name.
 * The room filepath ends in `{publisher_identity}-{track_source}-{track_id}`.
 */
export function trackIdFromEgressFile(filename: string): string | null {
  const base = filename.split("/").pop() ?? "";
  const match = base.match(/-(TR_[A-Za-z0-9]+)$/);
  return match?.[1] ?? null;
}

/**
 * Splits an egress file location into the bucket and key this app's storage settings can open.
 */
export function parseCaptureObjectLocation(
  location: string,
  configuredBucket: string,
): { bucket: string; key: string } | null {
  const trimmed = location.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("s3://")) {
    const rest = trimmed.slice("s3://".length);
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1) return null;
    return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
  }

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    try {
      const url = new URL(trimmed);
      const path = url.pathname.replace(/^\/+/, "");
      if (!path) return null;
      const host = url.hostname;
      const virtual = host.match(/^(.+)\.s3[.-][a-z0-9-]+\.amazonaws\.com$/);
      if (virtual?.[1]) return { bucket: virtual[1], key: path };
      const parts = path.split("/");
      if (parts.length >= 2 && parts[0] === configuredBucket) {
        return { bucket: parts[0], key: parts.slice(1).join("/") };
      }
      if (host.startsWith("s3.") || host.includes(".s3.")) {
        if (parts.length < 2) return null;
        return { bucket: parts[0], key: parts.slice(1).join("/") };
      }
      if (parts[0] === configuredBucket && parts.length >= 2) {
        return { bucket: configuredBucket, key: parts.slice(1).join("/") };
      }
      return { bucket: configuredBucket, key: path };
    } catch {
      return null;
    }
  }

  return { bucket: configuredBucket, key: trimmed.replace(/^\/+/, "") };
}

function closedRoomProblems(
  input: CaptureHealthInput,
  track: StoredCaptureTrack,
  graceMs: number,
): Problem[] {
  const row = input.egress.find((item) => item.trackId === track.trackId) ?? null;
  const quietFor = input.nowMs - (track.unpublishedAtMs ?? track.lastSeenAtMs);
  if (!row) {
    if (quietFor <= graceMs) return [];
    return [
      {
        detection: "file_missing",
        trackId: track.trackId,
        egressId: null,
        participantIdentity: track.participantIdentity,
        startOffsetMs: mediaOffset(input.mediaStartedAtMs, track.firstSeenAtMs),
        detail: `No recording file for ${track.participantIdentity}. Minutes for that interval are incomplete.`,
      },
    ];
  }

  if (LIVE_STATUS.has(row.status)) return [];

  if (FAILED_STATUS.has(row.status)) return [];

  if (row.status !== "complete") return [];

  if (!track.fileOpened) {
    return [
      {
        detection: "file_missing",
        trackId: track.trackId,
        egressId: row.egressId,
        participantIdentity: track.participantIdentity,
        startOffsetMs: mediaOffset(input.mediaStartedAtMs, track.firstSeenAtMs),
        detail: `The recording for ${track.participantIdentity} is not in the bucket. Minutes for that interval are incomplete.`,
      },
    ];
  }

  const span = publishedSpan(input.mediaStartedAtMs, track);
  if (track.fileDurationMs == null) {
    return [
      {
        detection: "duration_short",
        trackId: track.trackId,
        egressId: row.egressId,
        participantIdentity: track.participantIdentity,
        startOffsetMs: span?.start ?? 0,
        detail: `The recording for ${track.participantIdentity} has no duration, so coverage cannot be shown.`,
      },
    ];
  }

  if (span) {
    const required = Math.max(0, span.end - span.start - gapOverlapMs(input.gaps, track.trackId, span));
    if (track.fileDurationMs + CAPTURE_DURATION_TOLERANCE_MS < required) {
      return [
        {
          detection: "duration_short",
          trackId: track.trackId,
          egressId: row.egressId,
          participantIdentity: track.participantIdentity,
          startOffsetMs: span.start,
          detail: `The recording for ${track.participantIdentity} is shorter than the time that microphone was publishing, even after stored gaps.`,
        },
      ];
    }
  }

  if (track.fileStartedAtMs == null) {
    return [
      {
        detection: "clock_unmeasured",
        trackId: track.trackId,
        egressId: row.egressId,
        participantIdentity: track.participantIdentity,
        startOffsetMs: span?.start ?? 0,
        detail: `The recording for ${track.participantIdentity} has no start time, so the clock delta against the media clock was not measured.`,
      },
    ];
  }

  return [];
}

function healthFrom(problems: Problem[], input: CaptureHealthInput): RecordingHealth {
  if (problems.length > 0) {
    return {
      severity: "critical",
      state: "failed",
      label: "Critical",
      detail: problems.map((problem) => problem.detail).join(" "),
    };
  }

  const liveCount = input.egress.filter((row) => LIVE_STATUS.has(row.status)).length;
  const delta = largestClockDelta(input);

  if (input.roomClosed) {
    const completed = input.tracks.filter((track) => track.fileOpened).length;
    if (completed > 0) {
      const countLabel = completed === 1 ? "1 track file is" : `${completed} track files are`;
      const deltaLabel =
        delta == null
          ? "The clock delta was not measured."
          : `The largest file start is ${formatDelta(delta)} the media clock.`;
      return {
        severity: "healthy",
        state: "finished",
        label: "Recording stored",
        detail: `${countLabel} in the bucket and can be opened. ${deltaLabel}`,
      };
    }
    if (liveCount > 0) {
      return {
        severity: "healthy",
        state: "recording",
        label: "Recording",
        detail: "The room is empty. Track files are still finishing.",
      };
    }
    return {
      severity: "healthy",
      state: "waiting",
      label: "Waiting",
      detail: "The room is empty and no microphone was published.",
    };
  }

  if (liveCount > 0) {
    const countLabel = liveCount === 1 ? "1 track recording" : `${liveCount} track recordings`;
    return {
      severity: "healthy",
      state: "recording",
      label: "Recording",
      detail: `${countLabel} in progress, matched to publishing microphones.`,
    };
  }

  return {
    severity: "healthy",
    state: "waiting",
    label: "Waiting",
    detail: "No microphone is publishing. Recording starts when someone turns a microphone on.",
  };
}

function gapShouldClose(
  gap: CaptureGapView,
  input: CaptureHealthInput,
  problems: Problem[],
  graceMs: number,
): boolean {
  if (gap.detection === "backup_accepted") return problems.length === 0;
  if (gap.detection === "status_read_failed") return input.statusReadOk;
  if (gap.detection === "storage_unconfigured") return input.storageConfigured;
  if (!input.statusReadOk || !input.storageConfigured) return false;

  if (gap.detection === "microphone_unmatched") {
    if (!gap.trackId) return false;
    if (liveEgressFor(input.egress, gap.trackId)) return true;
    return !input.publishing.some((mic) => mic.trackId === gap.trackId);
  }

  if (gap.detection === "egress_failed") {
    if (gap.trackId && liveEgressFor(input.egress, gap.trackId)) return true;
    if (gap.trackId && input.publishing.some((mic) => mic.trackId === gap.trackId)) return false;
    return true;
  }

  if (gap.detection === "file_missing" || gap.detection === "duration_short" || gap.detection === "clock_unmeasured") {
    if (!input.roomClosed || !gap.trackId) return false;
    const track = input.tracks.find((item) => item.trackId === gap.trackId);
    if (!track) return false;
    return closedRoomProblems(input, track, graceMs).every((problem) => problem.detection !== gap.detection);
  }

  return false;
}

function liveEgressFor(rows: CaptureTrackEgress[], trackId: string): CaptureTrackEgress | null {
  return rows.find((row) => row.trackId === trackId && LIVE_STATUS.has(row.status)) ?? null;
}

function failureCovered(gaps: CaptureGapView[], egressId: string): boolean {
  return gaps.some((gap) => gap.detection === "egress_failed" && gap.egressId === egressId);
}

function openGapExists(gaps: CaptureGapView[], problem: Problem): boolean {
  return gaps.some(
    (gap) =>
      gap.endOffsetMs == null &&
      gap.detection === problem.detection &&
      gap.trackId === problem.trackId &&
      (problem.egressId == null || gap.egressId === problem.egressId),
  );
}

function mediaOffset(mediaStartedAtMs: number | null, atMs: number): number {
  if (mediaStartedAtMs == null) return 0;
  return Math.max(0, atMs - mediaStartedAtMs);
}

function publishedSpan(
  mediaStartedAtMs: number | null,
  track: StoredCaptureTrack,
): { start: number; end: number } | null {
  if (mediaStartedAtMs == null) return null;
  const endWall = track.unpublishedAtMs ?? track.lastSeenAtMs;
  return {
    start: Math.max(0, track.firstSeenAtMs - mediaStartedAtMs),
    end: Math.max(0, endWall - mediaStartedAtMs),
  };
}

function gapOverlapMs(
  gaps: CaptureGapView[],
  trackId: string,
  span: { start: number; end: number },
): number {
  let total = 0;
  const pieces: Array<{ start: number; stop: number }> = [];
  for (const gap of gaps) {
    if (gap.trackId && gap.trackId !== trackId) continue;
    const end = gap.endOffsetMs ?? span.end;
    const start = Math.max(gap.startOffsetMs, span.start);
    const stop = Math.min(end, span.end);
    if (stop > start) pieces.push({ start, stop });
  }
  pieces.sort((a, b) => a.start - b.start);
  let cursor = span.start;
  for (const piece of pieces) {
    const start = Math.max(piece.start, cursor);
    if (piece.stop > start) {
      total += piece.stop - start;
      cursor = piece.stop;
    }
  }
  return total;
}

function largestClockDelta(input: CaptureHealthInput): number | null {
  if (input.mediaStartedAtMs == null) return null;
  let largest: number | null = null;
  for (const track of input.tracks) {
    if (track.fileStartedAtMs == null) continue;
    const delta = track.fileStartedAtMs - input.mediaStartedAtMs;
    if (largest == null || Math.abs(delta) > Math.abs(largest)) largest = delta;
  }
  return largest;
}

function formatDelta(deltaMs: number): string {
  const abs = Math.abs(deltaMs);
  const seconds = (abs / 1000).toFixed(1);
  return deltaMs >= 0 ? `${seconds}s after` : `${seconds}s before`;
}
