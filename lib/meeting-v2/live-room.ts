import { randomUUID } from "crypto";

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { RoomServiceClient, AccessToken } from "livekit-server-sdk";

import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2AgendaItems,
  meetingsV2LiveCaptureTracks,
  meetingsV2LiveNavigationEvents,
  meetingsV2LiveRecognitionCues,
  meetingsV2LiveRecognitionCorrections,
  meetingsV2LiveSessions,
} from "@/lib/db/schema";
import { acceptCaptureInterruption, syncCaptureLedger } from "@/lib/meeting-v2/capture-ledger";
import { presignCaptureObject } from "@/lib/livekit/capture-object";
import {
  liveKitTrackEgress,
  readLiveKitConfig,
  readLiveKitS3Egress,
} from "@/lib/livekit/config";
import {
  activeLiveFocus,
  effectivePresentedPage,
  liveAgendaLeaves,
  liveAgendaOutlineRows,
  navigationAllowed,
  pageMapCheckView,
  type LiveNavigationEventView,
  type LiveRoomLeaf,
  type LiveRoomSnapshot,
} from "@/lib/meeting-v2/live-agenda";
import { proposeVocabularyCorrections } from "@/lib/meeting-v2/live-corrections";
import {
  isDuplicateRecognitionCue,
  normalizeRecognitionText,
  recognitionCueOffsets,
  type LiveRecognitionCorrectionView,
  type LiveRecognitionCueView,
} from "@/lib/meeting-v2/live-recognition";
import {
  liveVocabularyPhrases,
  vocabularyFocus,
  type LiveVocabulary,
} from "@/lib/meeting-v2/live-vocabulary";
import {
  mediaOffsetMs,
  missingStorageRecordingHealth,
  unconfiguredRecordingHealth,
  type CaptureFileView,
  type CaptureGapView,
  type RecordingHealth,
} from "@/lib/meeting-v2/live-clock";
import { applyStoredCitationLinks } from "@/lib/meeting-v2/upcoming-meeting";
import type { MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";

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

  const [meeting] = await db
    .select({
      livePageMapCheckedAt: meetingsV2.livePageMapCheckedAt,
      livePageMapCheckedByIdentity: meetingsV2.livePageMapCheckedByIdentity,
      livePageMapCheckedByName: meetingsV2.livePageMapCheckedByName,
      settings: meetingsV2.settings,
    })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));

  const upcoming = ((meeting?.settings ?? {}) as MeetingV2Settings).upcomingMeeting;
  if (upcoming?.attachmentAssignment?.completedAt && !upcoming.attachmentAssignment.citationsAppliedAt) {
    try {
      await applyStoredCitationLinks(meetingId);
    } catch (error) {
      console.error("[meetings/v2/live] citation links", error);
    }
  }

  const { leaves, outline } = await loadLiveAgenda(meetingId);
  const [session] = await db
    .select()
    .from(meetingsV2LiveSessions)
    .where(eq(meetingsV2LiveSessions.meetingV2Id, meetingId));

  const navigation = session
    ? await db
        .select({
          id: meetingsV2LiveNavigationEvents.id,
          agendaItemId: meetingsV2LiveNavigationEvents.agendaItemId,
          unscheduled: meetingsV2LiveNavigationEvents.unscheduled,
          mediaOffsetMs: meetingsV2LiveNavigationEvents.mediaOffsetMs,
          actorIdentity: meetingsV2LiveNavigationEvents.actorIdentity,
          createdAt: meetingsV2LiveNavigationEvents.createdAt,
        })
        .from(meetingsV2LiveNavigationEvents)
        .where(eq(meetingsV2LiveNavigationEvents.sessionId, session.id))
        .orderBy(asc(meetingsV2LiveNavigationEvents.mediaOffsetMs))
    : [];

  const focus = activeLiveFocus(leaves, navigation);
  const config = readLiveKitConfig();
  const capture = await captureForSnapshot(config, session ?? null);

  return {
    configured: Boolean(config),
    roomName: session?.roomName ?? null,
    mediaStartedAt: session?.mediaStartedAt ?? null,
    activeAgendaItemId: focus?.kind === "leaf" ? focus.agendaItemId : null,
    activeUnscheduled: focus?.kind === "unscheduled",
    presenterIdentity: session?.presenterIdentity ?? null,
    presenterDisplayName: session?.presenterDisplayName ?? null,
    presentedPage: effectivePresentedPage(focus, leaves, session?.presentedPage ?? null),
    pageMap: pageMapCheckView({
      checkedAt: meeting?.livePageMapCheckedAt ?? null,
      checkedByIdentity: meeting?.livePageMapCheckedByIdentity ?? null,
      checkedByName: meeting?.livePageMapCheckedByName ?? null,
      leaves,
    }),
    leaves,
    outline,
    navigation,
    recording: capture.recording,
    captureGaps: capture.captureGaps,
    captureFiles: capture.captureFiles,
    clockDeltaMs: capture.clockDeltaMs,
  };
}

/**
 * Records that a person reviewed the leaf-to-page map. Does not open the room.
 */
export async function recordPageMapCheck(
  meetingId: string,
  participant: LiveParticipant,
  at: Date = new Date(),
): Promise<LiveRoomSnapshot> {
  await requireMeeting(meetingId);
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({
      livePageMapCheckedAt: at.toISOString(),
      livePageMapCheckedByIdentity: participant.identity,
      livePageMapCheckedByName: participant.displayName,
      updatedAt: at.toISOString(),
    })
    .where(eq(meetingsV2.id, meetingId));
  return getLiveRoomSnapshot(meetingId);
}

/**
 * Claims the presenter role when nobody else holds it.
 * Throws when the room has not been joined, or when another person is already presenting.
 */
export async function claimLivePresenter(
  meetingId: string,
  participant: LiveParticipant,
): Promise<LiveRoomSnapshot> {
  await requireMeeting(meetingId);
  const session = await loadSession(meetingId);
  const db = getDb();
  const [updated] = await db
    .update(meetingsV2LiveSessions)
    .set({
      presenterIdentity: participant.identity,
      presenterDisplayName: participant.displayName,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(meetingsV2LiveSessions.id, session.id),
        or(
          isNull(meetingsV2LiveSessions.presenterIdentity),
          eq(meetingsV2LiveSessions.presenterIdentity, participant.identity),
        ),
      ),
    )
    .returning({ id: meetingsV2LiveSessions.id });
  if (!updated) {
    throw new LiveRoomError("Someone else is presenting.", 409);
  }
  return getLiveRoomSnapshot(meetingId);
}

/**
 * Clears the presenter claim and any page they were showing to everyone.
 * Throws when this participant is not the presenter.
 */
export async function releaseLivePresenter(
  meetingId: string,
  participant: LiveParticipant,
): Promise<LiveRoomSnapshot> {
  await requireMeeting(meetingId);
  const session = await loadSession(meetingId);
  const db = getDb();
  const [updated] = await db
    .update(meetingsV2LiveSessions)
    .set({
      presenterIdentity: null,
      presenterDisplayName: null,
      presentedPage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(meetingsV2LiveSessions.id, session.id),
        eq(meetingsV2LiveSessions.presenterIdentity, participant.identity),
      ),
    )
    .returning({ id: meetingsV2LiveSessions.id });
  if (!updated) {
    throw new LiveRoomError("Only the presenter can stop presenting.", 403);
  }
  return getLiveRoomSnapshot(meetingId);
}

/**
 * Stores the package page the presenter is showing to everyone.
 * Does not insert a navigation event and does not change the active leaf.
 * Pass null to stop showing a page. Throws when the page is not on the active leaf.
 */
export async function presentLivePage(
  meetingId: string,
  participant: LiveParticipant,
  page: number | null,
): Promise<LiveRoomSnapshot> {
  await requireMeeting(meetingId);
  const session = await loadSession(meetingId);
  assertPresenter(session.presenterIdentity, participant.identity, "Only the presenter can show a page to everyone.");
  const db = getDb();

  if (page == null) {
    await db
      .update(meetingsV2LiveSessions)
      .set({ presentedPage: null, updatedAt: new Date().toISOString() })
      .where(eq(meetingsV2LiveSessions.id, session.id));
    return getLiveRoomSnapshot(meetingId);
  }

  if (!Number.isInteger(page) || page <= 0) {
    throw new LiveRoomError("Page must be a positive whole number.", 400);
  }

  const leaves = await loadLeaves(meetingId);
  const navigation = await loadNavigationTargets(session.id);
  const focus = activeLiveFocus(leaves, navigation);
  if (effectivePresentedPage(focus, leaves, page) == null) {
    throw new LiveRoomError("That page is not on the active agenda item.", 400);
  }

  await db
    .update(meetingsV2LiveSessions)
    .set({ presentedPage: page, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2LiveSessions.id, session.id));
  return getLiveRoomSnapshot(meetingId);
}

/**
 * Stores one finalized utterance as original recognition.
 * Does not write a transcript artifact or a transcript segment.
 * Returns null when the text is empty or the same utterance was just stored.
 */
export async function recordLiveRecognitionCue(
  meetingId: string,
  participant: LiveParticipant,
  input: { text: string; durationMs: number },
  at: Date = new Date(),
): Promise<LiveRecognitionCueView | null> {
  const text = normalizeRecognitionText(input.text);
  if (!text) {
    throw new LiveRoomError("Recognition text is empty.", 400);
  }
  const db = getDb();
  await requireMeeting(meetingId);
  const session = await loadSession(meetingId);
  const offsets = recognitionCueOffsets({
    endOffsetMs: mediaOffsetMs(session.mediaStartedAt, at),
    durationMs: input.durationMs,
  });

  const [previous] = await db
    .select({
      speakerIdentity: meetingsV2LiveRecognitionCues.speakerIdentity,
      text: meetingsV2LiveRecognitionCues.text,
      startOffsetMs: meetingsV2LiveRecognitionCues.startOffsetMs,
    })
    .from(meetingsV2LiveRecognitionCues)
    .where(
      and(
        eq(meetingsV2LiveRecognitionCues.sessionId, session.id),
        eq(meetingsV2LiveRecognitionCues.speakerIdentity, participant.identity),
      ),
    )
    .orderBy(desc(meetingsV2LiveRecognitionCues.createdAt))
    .limit(1);

  if (
    isDuplicateRecognitionCue({
      previous: previous ?? null,
      next: {
        speakerIdentity: participant.identity,
        text,
        startOffsetMs: offsets.startOffsetMs,
      },
    })
  ) {
    return null;
  }

  const leaves = await loadLeaves(meetingId);
  const navigation = await loadVocabularyNavigation(session.id);
  const focus = activeLiveFocus(leaves, navigation);
  const vocabulary = liveVocabularyFor(leaves, navigation, offsets.endOffsetMs);
  const id = randomUUID();
  const createdAt = at.toISOString();
  const row: LiveRecognitionCueView = {
    id,
    startOffsetMs: offsets.startOffsetMs,
    endOffsetMs: offsets.endOffsetMs,
    speakerIdentity: participant.identity,
    speakerLabel: participant.displayName,
    text,
    agendaItemId: focus?.kind === "leaf" ? focus.agendaItemId : null,
    corrections: [],
  };

  await db.insert(meetingsV2LiveRecognitionCues).values({
    id: row.id,
    startOffsetMs: row.startOffsetMs,
    endOffsetMs: row.endOffsetMs,
    speakerIdentity: row.speakerIdentity,
    speakerLabel: row.speakerLabel,
    text: row.text,
    agendaItemId: row.agendaItemId,
    meetingV2Id: meetingId,
    sessionId: session.id,
    vocabularyJson: JSON.stringify(vocabulary.phrases),
    createdAt,
  });

  const proposals = proposeVocabularyCorrections(text, vocabulary.phrases);
  const corrections: LiveRecognitionCorrectionView[] = [];
  for (const proposal of proposals) {
    const correction: LiveRecognitionCorrectionView = {
      id: randomUUID(),
      cueId: row.id,
      heardText: proposal.heardText,
      proposedText: proposal.proposedText,
      source: "vocabulary",
      status: "proposed",
      createdByIdentity: "vocabulary",
      decidedByIdentity: null,
    };
    corrections.push(correction);
    await db.insert(meetingsV2LiveRecognitionCorrections).values({
      ...correction,
      meetingV2Id: meetingId,
      sessionId: session.id,
      createdAt,
    });
  }

  return { ...row, corrections };
}

/**
 * Phrase hints for the open room at the current media clock.
 * Returns an empty list before anyone has joined.
 */
export async function listLiveVocabulary(
  meetingId: string,
  at: Date = new Date(),
): Promise<LiveVocabulary> {
  const empty: LiveVocabulary = { phrases: [], activeLeafId: null, hangoverLeafId: null };
  const db = getDb();
  await requireMeeting(meetingId);
  const [session] = await db
    .select()
    .from(meetingsV2LiveSessions)
    .where(eq(meetingsV2LiveSessions.meetingV2Id, meetingId));
  if (!session) return empty;
  const leaves = await loadLeaves(meetingId);
  const navigation = await loadVocabularyNavigation(session.id);
  return liveVocabularyFor(leaves, navigation, mediaOffsetMs(session.mediaStartedAt, at));
}

function liveVocabularyFor(
  leaves: LiveRoomLeaf[],
  navigation: Array<{ agendaItemId: string | null; unscheduled: boolean; mediaOffsetMs: number }>,
  nowOffsetMs: number,
): LiveVocabulary {
  const focus = vocabularyFocus({ leaves, navigation, nowOffsetMs });
  return liveVocabularyPhrases({
    leaves: leaves.map((leaf) => ({
      id: leaf.id,
      title: leaf.title,
      sourceText: leaf.sourceText,
    })),
    activeLeafId: focus.activeLeafId,
    hangoverLeafId: focus.hangoverLeafId,
  });
}

/**
 * Recent original recognition cues for the open room, oldest first.
 */
export async function listLiveRecognitionCues(
  meetingId: string,
  limit = 40,
): Promise<LiveRecognitionCueView[]> {
  const db = getDb();
  await requireMeeting(meetingId);
  const session = await loadSession(meetingId);
  const rows = await db
    .select({
      id: meetingsV2LiveRecognitionCues.id,
      startOffsetMs: meetingsV2LiveRecognitionCues.startOffsetMs,
      endOffsetMs: meetingsV2LiveRecognitionCues.endOffsetMs,
      speakerIdentity: meetingsV2LiveRecognitionCues.speakerIdentity,
      speakerLabel: meetingsV2LiveRecognitionCues.speakerLabel,
      text: meetingsV2LiveRecognitionCues.text,
      agendaItemId: meetingsV2LiveRecognitionCues.agendaItemId,
    })
    .from(meetingsV2LiveRecognitionCues)
    .where(eq(meetingsV2LiveRecognitionCues.sessionId, session.id))
    .orderBy(desc(meetingsV2LiveRecognitionCues.startOffsetMs))
    .limit(Math.min(80, Math.max(1, limit)));
  const ordered = rows.reverse();
  const cueIds = ordered.map((row) => row.id);
  const corrections = cueIds.length
    ? await db
        .select({
          id: meetingsV2LiveRecognitionCorrections.id,
          cueId: meetingsV2LiveRecognitionCorrections.cueId,
          heardText: meetingsV2LiveRecognitionCorrections.heardText,
          proposedText: meetingsV2LiveRecognitionCorrections.proposedText,
          source: meetingsV2LiveRecognitionCorrections.source,
          status: meetingsV2LiveRecognitionCorrections.status,
          createdByIdentity: meetingsV2LiveRecognitionCorrections.createdByIdentity,
          decidedByIdentity: meetingsV2LiveRecognitionCorrections.decidedByIdentity,
        })
        .from(meetingsV2LiveRecognitionCorrections)
        .where(inArray(meetingsV2LiveRecognitionCorrections.cueId, cueIds))
    : [];
  return ordered.map((row) => ({
    ...row,
    corrections: corrections.filter((correction) => correction.cueId === row.id),
  }));
}

/**
 * Accepts or dismisses a caption suggestion. The original cue text is left as heard.
 */
export async function decideLiveRecognitionCorrection(
  meetingId: string,
  correctionId: string,
  participant: LiveParticipant,
  status: "accepted" | "rejected",
  at: Date = new Date(),
): Promise<LiveRecognitionCorrectionView> {
  const db = getDb();
  await requireMeeting(meetingId);
  const [existing] = await db
    .select()
    .from(meetingsV2LiveRecognitionCorrections)
    .where(
      and(
        eq(meetingsV2LiveRecognitionCorrections.id, correctionId),
        eq(meetingsV2LiveRecognitionCorrections.meetingV2Id, meetingId),
      ),
    );
  if (!existing) {
    throw new LiveRoomError("That caption suggestion was not found.", 404);
  }
  if (existing.status !== "proposed") {
    throw new LiveRoomError("That caption suggestion was already decided.", 409);
  }

  const decidedAt = at.toISOString();
  await db
    .update(meetingsV2LiveRecognitionCorrections)
    .set({
      status,
      decidedByIdentity: participant.identity,
      decidedAt,
    })
    .where(eq(meetingsV2LiveRecognitionCorrections.id, correctionId));

  return {
    id: existing.id,
    cueId: existing.cueId,
    heardText: existing.heardText,
    proposedText: existing.proposedText,
    source: existing.source,
    status,
    createdByIdentity: existing.createdByIdentity,
    decidedByIdentity: participant.identity,
  };
}

/**
 * Records that discussion after this moment is absent until capture is healthy again.
 */
export async function recordCaptureInterruption(
  meetingId: string,
  participant: LiveParticipant,
  at: Date = new Date(),
): Promise<LiveRoomSnapshot> {
  await requireMeeting(meetingId);
  const db = getDb();
  const [session] = await db
    .select()
    .from(meetingsV2LiveSessions)
    .where(eq(meetingsV2LiveSessions.meetingV2Id, meetingId));
  if (!session) {
    throw new LiveRoomError("Join the room before recording a capture interruption.", 409);
  }
  // CONCERN: no facilitator role yet; any participant can record the interruption.
  await acceptCaptureInterruption(session, participant.identity, at);
  return getLiveRoomSnapshot(meetingId);
}

/**
 * Short-lived playback URL for one stored track file.
 * Throws when the file has not been opened in the bucket.
 */
export async function capturePlaybackUrl(meetingId: string, trackSid: string): Promise<string> {
  await requireMeeting(meetingId);
  const db = getDb();
  const [track] = await db
    .select()
    .from(meetingsV2LiveCaptureTracks)
    .where(
      and(
        eq(meetingsV2LiveCaptureTracks.meetingV2Id, meetingId),
        eq(meetingsV2LiveCaptureTracks.trackSid, trackSid),
      ),
    );
  if (!track?.fileLocation || !track.fileOpenedAt) {
    throw new LiveRoomError("That recording is not available to play.", 404);
  }
  return presignCaptureObject(track.fileLocation);
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
 * Only the presenter can move the agenda. The offset is server elapsed time, not a wall clock.
 * Jumping back appends a new row. The shared stage page becomes the requested page, or the leaf's first linked page.
 */
export async function recordLiveNavigation(
  meetingId: string,
  target: { agendaItemId: string; page?: number | null } | { unscheduled: true },
  participant: LiveParticipant,
  at: Date = new Date(),
): Promise<LiveRoomSnapshot> {
  const db = getDb();
  await requireMeeting(meetingId);
  const session = await loadSession(meetingId);
  assertPresenter(session.presenterIdentity, participant.identity, "Only the presenter can move the agenda.");

  const unscheduled = "unscheduled" in target;
  const leaves = await loadLeaves(meetingId);
  const leaf = unscheduled ? undefined : leaves.find((item) => item.id === target.agendaItemId);
  if (!unscheduled && !leaf) {
    throw new LiveRoomError("That agenda item is not a leaf in this meeting.", 400);
  }
  const requestedPage = !unscheduled && "page" in target ? target.page : null;
  const presentedPage = leaf
    ? typeof requestedPage === "number" && leaf.sourcePages.includes(requestedPage)
      ? requestedPage
      : (leaf.sourcePages[0] ?? null)
    : null;

  await db.transaction(async (tx) => {
    await tx.insert(meetingsV2LiveNavigationEvents).values({
      id: randomUUID(),
      meetingV2Id: meetingId,
      sessionId: session.id,
      agendaItemId: unscheduled ? null : target.agendaItemId,
      unscheduled,
      mediaOffsetMs: mediaOffsetMs(session.mediaStartedAt, at),
      actorIdentity: participant.identity,
      actorUserId: participant.userId,
      createdAt: at.toISOString(),
    });
    await tx
      .update(meetingsV2LiveSessions)
      .set({ presentedPage, updatedAt: at.toISOString() })
      .where(eq(meetingsV2LiveSessions.id, session.id));
  });

  return getLiveRoomSnapshot(meetingId);
}

function assertPresenter(
  presenterIdentity: string | null,
  actorIdentity: string,
  message: string,
): void {
  if (!navigationAllowed(presenterIdentity, actorIdentity)) {
    throw new LiveRoomError(message, 403);
  }
}

async function loadSession(meetingId: string) {
  const db = getDb();
  const [session] = await db
    .select()
    .from(meetingsV2LiveSessions)
    .where(eq(meetingsV2LiveSessions.meetingV2Id, meetingId));
  if (!session) {
    throw new LiveRoomError("Join the room before moving the agenda.", 409);
  }
  return session;
}

async function loadNavigationTargets(sessionId: string) {
  const rows = await loadVocabularyNavigation(sessionId);
  return rows.map((row) => ({
    agendaItemId: row.agendaItemId,
    unscheduled: row.unscheduled,
  }));
}

async function loadVocabularyNavigation(sessionId: string) {
  const db = getDb();
  return db
    .select({
      agendaItemId: meetingsV2LiveNavigationEvents.agendaItemId,
      unscheduled: meetingsV2LiveNavigationEvents.unscheduled,
      mediaOffsetMs: meetingsV2LiveNavigationEvents.mediaOffsetMs,
    })
    .from(meetingsV2LiveNavigationEvents)
    .where(eq(meetingsV2LiveNavigationEvents.sessionId, sessionId))
    .orderBy(asc(meetingsV2LiveNavigationEvents.mediaOffsetMs));
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

async function loadLiveAgenda(
  meetingId: string,
): Promise<{ leaves: LiveRoomLeaf[]; outline: ReturnType<typeof liveAgendaOutlineRows> }> {
  const db = getDb();
  const items = await db
    .select({
      id: meetingsV2AgendaItems.id,
      itemNumber: meetingsV2AgendaItems.itemNumber,
      title: meetingsV2AgendaItems.title,
      sectionLabel: meetingsV2AgendaItems.sectionLabel,
      sourceText: meetingsV2AgendaItems.sourceText,
      sourcePagesJson: meetingsV2AgendaItems.sourcePagesJson,
    })
    .from(meetingsV2AgendaItems)
    .where(eq(meetingsV2AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV2AgendaItems.sortOrder));
  return {
    leaves: liveAgendaLeaves(items),
    outline: liveAgendaOutlineRows(items),
  };
}

async function loadLeaves(meetingId: string): Promise<LiveRoomLeaf[]> {
  const { leaves } = await loadLiveAgenda(meetingId);
  return leaves;
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

async function captureForSnapshot(
  config: ReturnType<typeof readLiveKitConfig>,
  session: {
    id: string;
    meetingV2Id: string;
    roomName: string;
    mediaStartedAt: string;
  } | null,
): Promise<{
  recording: RecordingHealth;
  captureGaps: CaptureGapView[];
  captureFiles: CaptureFileView[];
  clockDeltaMs: number | null;
}> {
  const empty = {
    captureGaps: [] as CaptureGapView[],
    captureFiles: [] as CaptureFileView[],
    clockDeltaMs: null as number | null,
  };
  if (!config) {
    return { ...empty, recording: unconfiguredRecordingHealth() };
  }
  if (!session) {
    return {
      ...empty,
      recording: readLiveKitS3Egress()
        ? {
            severity: "healthy",
            state: "waiting",
            label: "Waiting",
            detail: "No microphone is publishing. Recording starts when someone turns a microphone on.",
          }
        : missingStorageRecordingHealth(),
    };
  }
  return syncCaptureLedger(session, config, Boolean(readLiveKitS3Egress()));
}
