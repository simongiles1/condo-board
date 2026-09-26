import { randomUUID } from "crypto";

import { and, eq, isNull } from "drizzle-orm";
import {
  EgressClient,
  EgressStatus,
  RoomServiceClient,
  TrackSource,
  type EgressInfo,
  type ParticipantInfo,
} from "livekit-server-sdk";

import { getDb } from "@/lib/db";
import {
  meetingsV2LiveCaptureGaps,
  meetingsV2LiveCaptureTracks,
} from "@/lib/db/schema";
import { headCaptureObject } from "@/lib/livekit/capture-object";
import type { LiveKitConfig } from "@/lib/livekit/config";
import {
  assessCaptureHealth,
  liveKitTimestampMs,
  trackIdFromEgressFile,
  type CaptureTrackEgress,
  type PublishingMicrophone,
  type StoredCaptureTrack,
} from "@/lib/meeting-v2/capture-health";
import {
  mediaOffsetMs,
  type CaptureDetection,
  type CaptureFileView,
  type CaptureGapView,
  type RecordingEgressStatus,
  type RecordingHealth,
} from "@/lib/meeting-v2/live-clock";

type SessionRow = {
  id: string;
  meetingV2Id: string;
  roomName: string;
  mediaStartedAt: string;
};

export type CaptureLedgerView = {
  recording: RecordingHealth;
  captureGaps: CaptureGapView[];
  captureFiles: CaptureFileView[];
  clockDeltaMs: number | null;
};

/**
 * Reads LiveKit egress and publishing microphones, stores gaps, and returns capture health.
 * The room poll is the observer, so this read is what persists a gap. It does not start or stop egress.
 */
export async function syncCaptureLedger(
  session: SessionRow,
  config: LiveKitConfig,
  storageConfigured: boolean,
  now: Date = new Date(),
): Promise<CaptureLedgerView> {
  const db = getDb();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const mediaStartedAtMs = Date.parse(session.mediaStartedAt);

  const observed = await loadObserved(session.id);
  const read = await readLiveCapture(config, session.roomName);
  const publishing = publishingMics(read.participants, observed.tracks, nowMs);

  if (read.statusReadOk) {
    await upsertObservations(session, publishing, observed.tracks, nowIso);
  }

  let tracks = await loadTracks(session.id);
  if (read.statusReadOk && storageConfigured && read.roomClosed) {
    tracks = await openCompletedFiles(session, tracks, read.egress, mediaStartedAtMs, nowIso);
  }

  const stored = tracks.map(toStoredTrack);
  const gaps = observedGaps(await loadGaps(session.id));
  const assessment = assessCaptureHealth({
    nowMs,
    mediaStartedAtMs: Number.isFinite(mediaStartedAtMs) ? mediaStartedAtMs : null,
    storageConfigured,
    statusReadOk: read.statusReadOk,
    statusError: read.statusError,
    roomClosed: read.roomClosed,
    publishing,
    egress: read.egress,
    gaps,
    tracks: stored,
  });

  await applyGapWrites(session, assessment.drafts, assessment.closeGapIds, now, nowIso);

  const openGaps = observedGaps(
    (await loadGaps(session.id)).filter((gap) => gap.endOffsetMs == null),
  );
  return {
    recording: assessment.health,
    captureGaps: openGaps,
    captureFiles: tracks
      .filter((track) => track.fileLocation)
      .map((track) => ({
        trackId: track.trackSid,
        participantIdentity: track.participantIdentity,
        playable: Boolean(track.fileOpenedAt),
        durationMs: track.fileDurationMs,
        clockDeltaMs: track.clockDeltaMs,
      })),
    clockDeltaMs: assessment.clockDeltaMs,
  };
}

/**
 * Stores the facilitator mark that discussion after this moment is absent until capture is healthy.
 * Any participant can record it until a facilitator role exists.
 */
export async function acceptCaptureInterruption(
  session: SessionRow,
  actorIdentity: string,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb();
  const nowIso = now.toISOString();
  const offset = mediaOffsetMs(session.mediaStartedAt, now);
  const open = await db
    .select()
    .from(meetingsV2LiveCaptureGaps)
    .where(
      and(
        eq(meetingsV2LiveCaptureGaps.sessionId, session.id),
        isNull(meetingsV2LiveCaptureGaps.endOffsetMs),
      ),
    );

  const backup = open.find((gap) => gap.detection === "backup_accepted");
  if (!backup) {
    await db.insert(meetingsV2LiveCaptureGaps).values({
      id: randomUUID(),
      meetingV2Id: session.meetingV2Id,
      sessionId: session.id,
      detection: "backup_accepted",
      participantIdentity: null,
      trackSid: null,
      egressId: null,
      startOffsetMs: offset,
      endOffsetMs: null,
      detail:
        "Capture was interrupted. Discussion after this mark is absent until capture is healthy again.",
      acceptedAt: nowIso,
      acceptedByIdentity: actorIdentity,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  for (const gap of open) {
    if (gap.acceptedAt) continue;
    await db
      .update(meetingsV2LiveCaptureGaps)
      .set({
        acceptedAt: nowIso,
        acceptedByIdentity: actorIdentity,
        updatedAt: nowIso,
      })
      .where(eq(meetingsV2LiveCaptureGaps.id, gap.id));
  }
}

type TrackRow = typeof meetingsV2LiveCaptureTracks.$inferSelect;
type GapRow = typeof meetingsV2LiveCaptureGaps.$inferSelect;

async function loadObserved(sessionId: string): Promise<{ tracks: TrackRow[] }> {
  return { tracks: await loadTracks(sessionId) };
}

async function loadTracks(sessionId: string): Promise<TrackRow[]> {
  const db = getDb();
  return db
    .select()
    .from(meetingsV2LiveCaptureTracks)
    .where(eq(meetingsV2LiveCaptureTracks.sessionId, sessionId));
}

async function loadGaps(sessionId: string): Promise<GapRow[]> {
  const db = getDb();
  return db
    .select()
    .from(meetingsV2LiveCaptureGaps)
    .where(eq(meetingsV2LiveCaptureGaps.sessionId, sessionId));
}

function observedGaps(rows: GapRow[]): CaptureGapView[] {
  return rows.map((row) => ({
    id: row.id,
    detection: row.detection,
    participantIdentity: row.participantIdentity,
    trackId: row.trackSid,
    egressId: row.egressId,
    startOffsetMs: row.startOffsetMs,
    endOffsetMs: row.endOffsetMs,
    detail: row.detail,
    acceptedAt: row.acceptedAt,
  }));
}

function toStoredTrack(row: TrackRow): StoredCaptureTrack {
  return {
    trackId: row.trackSid,
    participantIdentity: row.participantIdentity,
    firstSeenAtMs: Date.parse(row.firstSeenAt),
    lastSeenAtMs: Date.parse(row.lastSeenAt),
    unpublishedAtMs: row.unpublishedAt ? Date.parse(row.unpublishedAt) : null,
    fileOpened: Boolean(row.fileOpenedAt),
    fileDurationMs: row.fileDurationMs,
    fileStartedAtMs: row.fileStartedAt ? Date.parse(row.fileStartedAt) : null,
  };
}

async function readLiveCapture(
  config: LiveKitConfig,
  roomName: string,
): Promise<{
  statusReadOk: boolean;
  statusError: string | null;
  roomClosed: boolean;
  participants: ParticipantInfo[];
  egress: CaptureTrackEgressWithFile[];
}> {
  const rooms = new RoomServiceClient(config.httpHost, config.apiKey, config.apiSecret);
  const egressClient = new EgressClient(config.httpHost, config.apiKey, config.apiSecret);
  try {
    const [participants, rows] = await Promise.all([
      rooms.listParticipants(roomName).catch((error: unknown) => {
        if (isMissingRoom(error)) return [] as ParticipantInfo[];
        throw error;
      }),
      egressClient.listEgress({ roomName }),
    ]);
    const roomMissing = participants.length === 0 && (await roomIsMissing(rooms, roomName));
    return {
      statusReadOk: true,
      statusError: null,
      roomClosed: roomMissing,
      participants,
      egress: rows.map(toCaptureEgress),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read capture status.";
    return {
      statusReadOk: false,
      statusError: message,
      roomClosed: false,
      participants: [],
      egress: [],
    };
  }
}

async function roomIsMissing(rooms: RoomServiceClient, roomName: string): Promise<boolean> {
  try {
    const listed = await rooms.listRooms([roomName]);
    return listed.length === 0;
  } catch (error) {
    if (isMissingRoom(error)) return true;
    throw error;
  }
}

function publishingMics(
  participants: ParticipantInfo[],
  existing: TrackRow[],
  nowMs: number,
): PublishingMicrophone[] {
  const firstSeen = new Map(existing.map((row) => [row.trackSid, Date.parse(row.firstSeenAt)]));
  const mics: PublishingMicrophone[] = [];
  for (const participant of participants) {
    for (const track of participant.tracks) {
      if (track.source !== TrackSource.MICROPHONE || track.muted || !track.sid) continue;
      mics.push({
        participantIdentity: participant.identity,
        trackId: track.sid,
        firstSeenAtMs: firstSeen.get(track.sid) ?? nowMs,
      });
    }
  }
  return mics;
}

async function upsertObservations(
  session: SessionRow,
  publishing: PublishingMicrophone[],
  existing: TrackRow[],
  nowIso: string,
): Promise<void> {
  const db = getDb();
  const live = new Set(publishing.map((mic) => mic.trackId));
  for (const mic of publishing) {
    const row = existing.find((item) => item.trackSid === mic.trackId);
    if (!row) {
      await db.insert(meetingsV2LiveCaptureTracks).values({
        id: randomUUID(),
        meetingV2Id: session.meetingV2Id,
        sessionId: session.id,
        participantIdentity: mic.participantIdentity,
        trackSid: mic.trackId,
        firstSeenAt: new Date(mic.firstSeenAtMs).toISOString(),
        lastSeenAt: nowIso,
        unpublishedAt: null,
        egressId: null,
        fileLocation: null,
        fileStartedAt: null,
        fileDurationMs: null,
        fileOpenedAt: null,
        clockDeltaMs: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      continue;
    }
    await db
      .update(meetingsV2LiveCaptureTracks)
      .set({
        participantIdentity: mic.participantIdentity,
        lastSeenAt: nowIso,
        unpublishedAt: null,
        updatedAt: nowIso,
      })
      .where(eq(meetingsV2LiveCaptureTracks.id, row.id));
  }

  for (const row of existing) {
    if (live.has(row.trackSid) || row.unpublishedAt) continue;
    await db
      .update(meetingsV2LiveCaptureTracks)
      .set({ unpublishedAt: nowIso, updatedAt: nowIso })
      .where(eq(meetingsV2LiveCaptureTracks.id, row.id));
  }
}

async function openCompletedFiles(
  session: SessionRow,
  tracks: TrackRow[],
  egress: CaptureTrackEgressWithFile[],
  mediaStartedAtMs: number,
  nowIso: string,
): Promise<TrackRow[]> {
  const db = getDb();
  const next: TrackRow[] = [];
  for (const track of tracks) {
    const row = egress.find((item) => item.trackId === track.trackSid);
    let updated = track;
    if (row?.location && row.status === "complete" && !track.fileOpenedAt) {
      const check = await headCaptureObject(row.location);
      const startedMs = row.fileStartedAtMs;
      const clockDeltaMs =
        startedMs != null && Number.isFinite(mediaStartedAtMs) ? startedMs - mediaStartedAtMs : null;
      updated = {
        ...track,
        egressId: row.egressId,
        fileLocation: row.location,
        fileStartedAt: startedMs != null ? new Date(startedMs).toISOString() : null,
        fileDurationMs: row.fileDurationMs,
        fileOpenedAt: check.opened ? nowIso : null,
        clockDeltaMs,
        updatedAt: nowIso,
      };
      await db
        .update(meetingsV2LiveCaptureTracks)
        .set({
          egressId: updated.egressId,
          fileLocation: updated.fileLocation,
          fileStartedAt: updated.fileStartedAt,
          fileDurationMs: updated.fileDurationMs,
          fileOpenedAt: updated.fileOpenedAt,
          clockDeltaMs: updated.clockDeltaMs,
          updatedAt: nowIso,
        })
        .where(eq(meetingsV2LiveCaptureTracks.id, track.id));
    } else if (row && (row.location || row.fileDurationMs != null || row.fileStartedAtMs != null)) {
      const startedMs = row.fileStartedAtMs;
      const clockDeltaMs =
        startedMs != null && Number.isFinite(mediaStartedAtMs) ? startedMs - mediaStartedAtMs : track.clockDeltaMs;
      updated = {
        ...track,
        egressId: row.egressId,
        fileLocation: row.location ?? track.fileLocation,
        fileStartedAt: startedMs != null ? new Date(startedMs).toISOString() : track.fileStartedAt,
        fileDurationMs: row.fileDurationMs ?? track.fileDurationMs,
        clockDeltaMs,
        updatedAt: nowIso,
      };
      await db
        .update(meetingsV2LiveCaptureTracks)
        .set({
          egressId: updated.egressId,
          fileLocation: updated.fileLocation,
          fileStartedAt: updated.fileStartedAt,
          fileDurationMs: updated.fileDurationMs,
          clockDeltaMs: updated.clockDeltaMs,
          updatedAt: nowIso,
        })
        .where(eq(meetingsV2LiveCaptureTracks.id, track.id));
    }
    next.push(updated);
  }
  void session;
  return next;
}

async function applyGapWrites(
  session: SessionRow,
  drafts: Array<{
    detection: Exclude<CaptureDetection, "backup_accepted">;
    trackId: string | null;
    egressId: string | null;
    participantIdentity: string | null;
    startOffsetMs: number;
    detail: string;
  }>,
  closeGapIds: string[],
  now: Date,
  nowIso: string,
): Promise<void> {
  const db = getDb();
  const endOffsetMs = mediaOffsetMs(session.mediaStartedAt, now);
  for (const draft of drafts) {
    await db.insert(meetingsV2LiveCaptureGaps).values({
      id: randomUUID(),
      meetingV2Id: session.meetingV2Id,
      sessionId: session.id,
      detection: draft.detection,
      participantIdentity: draft.participantIdentity,
      trackSid: draft.trackId,
      egressId: draft.egressId,
      startOffsetMs: draft.startOffsetMs,
      endOffsetMs: null,
      detail: draft.detail,
      acceptedAt: null,
      acceptedByIdentity: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
  for (const id of closeGapIds) {
    await db
      .update(meetingsV2LiveCaptureGaps)
      .set({ endOffsetMs, updatedAt: nowIso })
      .where(and(eq(meetingsV2LiveCaptureGaps.id, id), isNull(meetingsV2LiveCaptureGaps.endOffsetMs)));
  }
}

type CaptureTrackEgressWithFile = CaptureTrackEgress & {
  location: string | null;
  fileStartedAtMs: number | null;
  fileDurationMs: number | null;
};

function toCaptureEgress(row: EgressInfo): CaptureTrackEgressWithFile {
  const file = row.fileResults[0];
  const filename = file?.filename || file?.location || "";
  const trackId =
    (row.request.case === "track" ? row.request.value.trackId : "") ||
    trackIdFromEgressFile(filename) ||
    null;
  return {
    egressId: row.egressId,
    status: egressStatusName(row.status),
    error: row.error ?? "",
    trackId,
    location: file?.location || file?.filename || null,
    fileStartedAtMs: file ? liveKitTimestampMs(file.startedAt) : null,
    fileDurationMs: file ? liveKitTimestampMs(file.duration) : null,
  };
}

function egressStatusName(status: EgressStatus): RecordingEgressStatus {
  switch (status) {
    case EgressStatus.EGRESS_STARTING:
      return "starting";
    case EgressStatus.EGRESS_ACTIVE:
      return "active";
    case EgressStatus.EGRESS_ENDING:
      return "ending";
    case EgressStatus.EGRESS_COMPLETE:
      return "complete";
    case EgressStatus.EGRESS_ABORTED:
      return "aborted";
    case EgressStatus.EGRESS_LIMIT_REACHED:
      return "limit";
    case EgressStatus.EGRESS_FAILED:
    default:
      return "failed";
  }
}

function isMissingRoom(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist/i.test(message);
}
