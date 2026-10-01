/**
 * Stores what each topic's transcript stretch supports.
 * Package facts are not copied into the conclusion.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV3AgendaItems } from "@/lib/db/schema-v2";
import { readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { listMeetingV3Agenda, type MeetingsV3AgendaItem } from "@/lib/meeting-v3/agenda-run";
import {
  concludeFromDiscussion,
  discussionTextForSpans,
  type MeetingsV3ItemConclusion,
} from "@/lib/meeting-v3/meeting-conclusions";
import { writeMeetingsV3MeetingReconciliation } from "@/lib/meeting-v3/package-status";
import { loadMeetingCues, TranscriptSpanError } from "@/lib/meeting-v3/transcript-span-run";
import { readStoredItemTranscript } from "@/lib/meeting-v3/transcript-spans";
import {
  isMeetingsV3Workspace,
  meetingsV3FactGrouping,
  meetingsV3TranscriptSegmentation,
} from "@/lib/meeting-v3/workspace";

/** A reconciliation the route can return with an HTTP status. */
export class MeetingReconciliationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MeetingReconciliationError";
    this.status = status;
  }
}

/** The conclusions stored for one meeting. */
export type MeetingReconciliationResult = {
  meetingId: string;
  itemCount: number;
  unclearCount: number;
  items: MeetingsV3AgendaItem[];
};

/**
 * Replaces meeting conclusions on the V3 agenda from the full talk inside each stored stretch.
 * Throws MeetingReconciliationError when the meeting, transcript, or source links are not ready.
 */
export async function reconcileMeetingV3Conclusions(meetingId: string): Promise<MeetingReconciliationResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(meeting?.settings);
  if (!meeting || !isMeetingsV3Workspace(settings)) {
    throw new MeetingReconciliationError("Meeting not found.", 404);
  }
  if (!meetingsV3TranscriptSegmentation(settings)) {
    throw new MeetingReconciliationError("Segment the transcript before reconciling the meeting.", 409);
  }
  if (!meetingsV3FactGrouping(settings)) {
    throw new MeetingReconciliationError("Group sources before reconciling the meeting.", 409);
  }

  const itemRows = await db
    .select({
      id: meetingsV3AgendaItems.id,
      transcriptSpansJson: meetingsV3AgendaItems.transcriptSpansJson,
    })
    .from(meetingsV3AgendaItems)
    .where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3AgendaItems.sortOrder));
  if (itemRows.length === 0) {
    throw new MeetingReconciliationError("Build the agenda before reconciling the meeting.", 409);
  }

  let cues;
  try {
    cues = await loadMeetingCues(meetingId);
  } catch (error) {
    if (error instanceof TranscriptSpanError) {
      throw new MeetingReconciliationError(error.message, error.status);
    }
    throw error;
  }

  const conclusionsByItem = new Map<string, MeetingsV3ItemConclusion>();
  let unclearCount = 0;
  for (const item of itemRows) {
    const transcript = readStoredItemTranscript(item.transcriptSpansJson);
    const discussion = discussionTextForSpans(transcript?.spans ?? [], cues);
    const conclusion = concludeFromDiscussion(discussion);
    conclusionsByItem.set(item.id, conclusion);
    if (conclusion.status === "unclear") unclearCount += 1;
  }

  const completedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const item of itemRows) {
      await tx
        .update(meetingsV3AgendaItems)
        .set({ conclusionsJson: JSON.stringify(conclusionsByItem.get(item.id)) })
        .where(eq(meetingsV3AgendaItems.id, item.id));
    }
  });
  await writeMeetingsV3MeetingReconciliation(meetingId, {
    completedAt,
    itemCount: itemRows.length,
    unclearCount,
  });
  await db
    .update(meetingsV2)
    .set({
      currentStep: unclearCount > 0
        ? "Meeting reconciled; some topics have no decision in the transcript"
        : "Meeting conclusions stored from the transcript",
      updatedAt: completedAt,
    })
    .where(eq(meetingsV2.id, meetingId));

  return {
    meetingId,
    itemCount: itemRows.length,
    unclearCount,
    items: await listMeetingV3Agenda(meetingId),
  };
}
