import { randomUUID } from "crypto";

import { asc, eq } from "drizzle-orm";
import {
  EgressClient,
  EgressStatus,
  RoomServiceClient,
  AccessToken,
  type EgressInfo,
} from "livekit-server-sdk";

import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2AgendaItems,
  meetingsV2LiveNavigationEvents,
  meetingsV2LiveSessions,
} from "@/lib/db/schema";
import {
  liveKitTrackEgress,
  readLiveKitConfig,
  readLiveKitS3Egress,
} from "@/lib/livekit/config";
import {
  activeLeafId,
  liveAgendaLeaves,
  type LiveNavigationEventView,
  type LiveRoomLeaf,
  type LiveRoomSnapshot,
} from "@/lib/meeting-v2/live-agenda";
import {
  mediaOffsetMs,
  missingStorageRecordingHealth,
  summarizeRecordingHealth,
  unconfiguredRecordingHealth,
  type RecordingEgressSnapshot,
  type RecordingEgressStatus,
  type RecordingHealth,
} from "@/lib/meeting-v2/live-clock";

export type { LiveRoomSnapshot, LiveNavigationEventView };

export type LiveParticipant = {
  identity: string;
  displayName: string;
  userId: string | null;
};

export class LiveRoomError extends Error {
  /**
   * HTTP status for a live-room failure.
   */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const ROOM_DEPARTURE_TIMEOUT_SECONDS = 180;
const ROOM_EMPTY_TIMEOUT_SECONDS = 600;

/**
 * Agenda, navigation, and recording health for a meeting room.
 * Does not create the LiveKit room.
 */
export async function getLiveRoomSnapshot(meetingId: string): Promise<LiveRoomSnapshot> {
  const db = getDb();
  await requireMeeting(meetingId);

  const leaves = await loadLeaves(meetingId);
  const [session] = await db
    .select()
    .from(meetingsV2LiveSessions)
    .where(eq(meetingsV2LiveSessions.meetingV2Id, meetingId));

  const navigation = session
    ? await db
        .select({
          id: meetingsV2LiveNavigationEvents.id,
          agendaItemId: meetingsV2LiveNavigationEvents.agendaItemId,
          mediaOffsetMs: meetingsV2LiveNavigationEvents.mediaOffsetMs,
          actorIdentity: meetingsV2LiveNavigationEvents.actorIdentity,
          createdAt: meetingsV2LiveNavigationEvents.createdAt,
        })
        .from(meetingsV2LiveNavigationEvents)
        .where(eq(meetingsV2LiveNavigationEvents.sessionId, session.id))
        .orderBy(asc(meetingsV2LiveNavigationEvents.mediaOffsetMs))
    : [];

  const config = readLiveKitConfig();
  const recording = !config
    ? unconfiguredRecordingHealth()
    : !readLiveKitS3Egress()
      ? missingStorageRecordingHealth()
      : await recordingHealth(
          config.httpHost,
          config.apiKey,
          config.apiSecret,
          session?.roomName ?? null,
        );

  return {
    configured: Boolean(config),
    roomName: session?.roomName ?? null,
    mediaStartedAt: session?.mediaStartedAt ?? null,
    activeAgendaItemId: activeLeafId(
      leaves,
      navigation.map((event) => event.agendaItemId),
    ),
    leaves,
    navigation,
    recording,
  };
}

/**
 * Opens or rejoins the meeting's LiveKit room and returns a participant token.
 * The room name and media origin stay stable across refresh.
 */
export async function joinLiveRoom(
  meetingId: string,
  participant: LiveParticipant,
): Promise<{ token: string; serverUrl: string; snapshot: LiveRoomSnapshot }> {
  const config = readLiveKitConfig();
  if (!config) {
    throw new LiveRoomError(
      "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.",
      503,
    );
  }

  await requireMeeting(meetingId);
  const session = await ensureSession(meetingId);
  const rooms = new RoomServiceClient(config.httpHost, config.apiKey, config.apiSecret);
  const egress = liveKitTrackEgress();

  // CreateRoom applies egress only the first time. A later call returns the same room
  // so a refresh rejoins it instead of starting a second recording.
  // Omit egress when no bucket is set. Cloud rejects a filepath with no output and
  // then the participant cannot join at all.
  try {
    await rooms.createRoom({
      name: session.roomName,
      emptyTimeout: ROOM_EMPTY_TIMEOUT_SECONDS,
      departureTimeout: ROOM_DEPARTURE_TIMEOUT_SECONDS,
      metadata: JSON.stringify({
        meetingV2Id: meetingId,
        mediaStartedAt: session.mediaStartedAt,
      }),
      ...(egress ? { egress } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open the live room.";
    throw new LiveRoomError(message.replace(/^Bad Request:\s*/i, ""), 502);
  }

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: participant.identity,
    name: participant.displayName,
    ttl: "6h",
  });
  token.addGrant({
    roomJoin: true,
    room: session.roomName,
    canPublish: true,
    canSubscribe: true,
  });

  return {
    token: await token.toJwt(),
    serverUrl: config.url,
    snapshot: await getLiveRoomSnapshot(meetingId),
  };
}

/**
 * Stores one agenda navigation prior on the room media clock.
 * The offset is computed here so the click is not the facilitator's wall clock.
 */
export async function recordLiveNavigation(
  meetingId: string,
  agendaItemId: string,
  participant: LiveParticipant,
  at: Date = new Date(),
): Promise<LiveRoomSnapshot> {
  const db = getDb();
  await requireMeeting(meetingId);

  const [session] = await db
    .select()
    .from(meetingsV2LiveSessions)
    .where(eq(meetingsV2LiveSessions.meetingV2Id, meetingId));
  if (!session) {
    throw new LiveRoomError("Join the room before moving the agenda.", 409);
  }

  const leaves = await loadLeaves(meetingId);
  if (!leaves.some((leaf) => leaf.id === agendaItemId)) {
    throw new LiveRoomError("That agenda item is not a leaf in this meeting.", 400);
  }

  await db.insert(meetingsV2LiveNavigationEvents).values({
    id: randomUUID(),
    meetingV2Id: meetingId,
    sessionId: session.id,
    agendaItemId,
    mediaOffsetMs: mediaOffsetMs(session.mediaStartedAt, at),
    actorIdentity: participant.identity,
    actorUserId: participant.userId,
    createdAt: at.toISOString(),
  });

  return getLiveRoomSnapshot(meetingId);
}

async function requireMeeting(meetingId: string): Promise<void> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  if (!meeting) {
    throw new LiveRoomError("Meeting not found.", 404);
  }
}

async function loadLeaves(meetingId: string): Promise<LiveRoomLeaf[]> {
  const db = getDb();
  const items = await db
    .select({
      id: meetingsV2AgendaItems.id,
      itemNumber: meetingsV2AgendaItems.itemNumber,
      title: meetingsV2AgendaItems.title,
      sourceText: meetingsV2AgendaItems.sourceText,
      sourcePagesJson: meetingsV2AgendaItems.sourcePagesJson,
    })
    .from(meetingsV2AgendaItems)
    .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2AgendaItems.sortOrder));
  return liveAgendaLeaves(items);
}

async function ensureSession(meetingId: string) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(meetingsV2LiveSessions)
    .where(eq(meetingsV2LiveSessions.meetingV2Id, meetingId));
  if (existing) return existing;

  const now = new Date().toISOString();
  const created = {
    id: randomUUID(),
    meetingV2Id: meetingId,
    roomName: `v2-${meetingId}`,
    mediaStartedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(meetingsV2LiveSessions).values(created);
    return created;
  } catch (error) {
    const [raced] = await db
      .select()
      .from(meetingsV2LiveSessions)
      .where(eq(meetingsV2LiveSessions.meetingV2Id, meetingId));
    if (raced) return raced;
    throw error;
  }
}

async function recordingHealth(
  httpHost: string,
  apiKey: string,
  apiSecret: string,
  roomName: string | null,
): Promise<RecordingHealth> {
  if (!roomName) {
    return summarizeRecordingHealth([]);
  }

  try {
    const egress = new EgressClient(httpHost, apiKey, apiSecret);
    const rows = await egress.listEgress({ roomName });
    return summarizeRecordingHealth(rows.map(egressSnapshot));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read recording status.";
    return {
      state: "unknown",
      label: "Unknown",
      detail: message,
    };
  }
}

function egressSnapshot(row: EgressInfo): RecordingEgressSnapshot {
  return {
    status: egressStatusName(row.status),
    error: row.error ?? "",
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
