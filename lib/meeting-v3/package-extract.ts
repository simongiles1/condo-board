/**
 * Extracts a V3 meeting's board package, then corrects agenda-side pages.
 */

import { ingestMeetingV2Sources, updateMeetingV2Status } from "@/lib/meeting-v2/service";
import {
  loadMeetingsV3PackageStatus,
  writeMeetingsV3PackageStage,
  type MeetingsV3PackageStatus,
} from "@/lib/meeting-v3/package-status";
import { buildMeetingPageRewrites, PageRewriteError } from "@/lib/meeting-v3/page-rewrite-run";

/** A V3 package run the route can return with an HTTP status. */
export class MeetingsV3PackageError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MeetingsV3PackageError";
    this.status = status;
  }
}

async function runMeetingsV3AgendaCorrectionPhase(meetingId: string): Promise<void> {
  await writeMeetingsV3PackageStage(meetingId, "correcting", null);
  await updateMeetingV2Status(
    meetingId,
    "ingested",
    "Correcting agenda pages",
    70,
    null,
  );
  await buildMeetingPageRewrites(meetingId);
  await writeMeetingsV3PackageStage(meetingId, "ready", null);
  await updateMeetingV2Status(meetingId, "ingested", "Agenda pages are corrected", 100, null);
}

/**
 * Rewrites agenda pages from the stored Docling extract without re-running Docling.
 * Throws MeetingsV3PackageError when the meeting is missing, has no pages, or correction fails.
 * Extracted pages stay in place when correction fails.
 */
export async function runMeetingsV3AgendaCorrectionOnly(meetingId: string): Promise<MeetingsV3PackageStatus> {
  const existing = await loadMeetingsV3PackageStatus(meetingId);
  if (!existing) {
    throw new MeetingsV3PackageError("Meeting not found.", 404);
  }
  if (existing.pageCount === 0) {
    throw new MeetingsV3PackageError("Extract the board package before correcting agenda pages.", 409);
  }

  try {
    await runMeetingsV3AgendaCorrectionPhase(meetingId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Page correction failed.";
    await writeMeetingsV3PackageStage(meetingId, "failed", message);
    await updateMeetingV2Status(meetingId, "failed", "Page correction failed", 0, message);
    if (error instanceof PageRewriteError) {
      throw error;
    }
    if (error instanceof MeetingsV3PackageError) {
      throw error;
    }
    throw new MeetingsV3PackageError(message, 500);
  }

  const status = await loadMeetingsV3PackageStatus(meetingId);
  if (!status) {
    throw new MeetingsV3PackageError("Meeting not found.", 404);
  }
  return status;
}

/**
 * Reads the board package into stored pages, then rewrites each agenda page from its PDF.
 * Throws MeetingsV3PackageError when the meeting is missing or is not a V3 workspace.
 * A correction failure leaves the extracted pages in place and marks the run failed.
 */
export async function runMeetingsV3PackageExtraction(meetingId: string): Promise<MeetingsV3PackageStatus> {
  const existing = await loadMeetingsV3PackageStatus(meetingId);
  if (!existing) {
    throw new MeetingsV3PackageError("Meeting not found.", 404);
  }

  await writeMeetingsV3PackageStage(meetingId, "extracting", null);
  await updateMeetingV2Status(
    meetingId,
    "ingesting",
    "Extracting the board package",
    10,
    null,
  );

  try {
    const ingested = await ingestMeetingV2Sources(meetingId);
    if (ingested.documentPages === 0) {
      throw new MeetingsV3PackageError("The board package produced no pages.", 422);
    }
    await runMeetingsV3AgendaCorrectionPhase(meetingId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Package extraction failed.";
    await writeMeetingsV3PackageStage(meetingId, "failed", message);
    await updateMeetingV2Status(meetingId, "failed", "Package extraction failed", 0, message);
    if (error instanceof MeetingsV3PackageError || error instanceof PageRewriteError) {
      throw error;
    }
    throw new MeetingsV3PackageError(message, 500);
  }

  const status = await loadMeetingsV3PackageStatus(meetingId);
  if (!status) {
    throw new MeetingsV3PackageError("Meeting not found.", 404);
  }
  return status;
}
