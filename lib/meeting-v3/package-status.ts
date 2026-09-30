/**
 * Reads V3 package progress without starting extraction.
 */

import { count, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  meetingsV2,
  meetingsV2DocumentPages,
  meetingsV3AgendaItems,
  meetingsV3PageRewrites,
} from "@/lib/db/schema-v2";
import { readMeetingV2Settings, type MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import {
  isMeetingsV3Workspace,
  meetingsV3PackageError,
  meetingsV3PackageStage,
  type MeetingsV3PackageSettings,
  type MeetingsV3PackageStage,
} from "@/lib/meeting-v3/workspace";

/** One row on the V3 meetings list. */
export type MeetingsV3WorkspaceCard = {
  id: string;
  title: string;
  meetingDate: string;
  stage: MeetingsV3PackageStage;
  error: string | null;
  currentStep: string | null;
  pageCount: number;
  correctedPageCount: number;
  agendaItemCount: number;
};

/** Package progress for one V3 meeting. */
export type MeetingsV3PackageStatus = {
  id: string;
  title: string;
  meetingDate: string;
  stage: MeetingsV3PackageStage;
  error: string | null;
  currentStep: string | null;
  pageCount: number;
  correctedPageCount: number;
  agendaItemCount: number;
};

/**
 * V3 workspaces, newest meeting date first.
 */
export async function listMeetingsV3Workspaces(): Promise<MeetingsV3WorkspaceCard[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: meetingsV2.id,
      title: meetingsV2.title,
      meetingDate: meetingsV2.meetingDate,
      settings: meetingsV2.settings,
      currentStep: meetingsV2.currentStep,
    })
    .from(meetingsV2)
    .orderBy(desc(meetingsV2.meetingDate));
  const workspaces = rows.filter((row) => isMeetingsV3Workspace(row.settings));
  if (workspaces.length === 0) return [];

  const ids = workspaces.map((row) => row.id);
  const [pageCounts, correctedCounts, agendaCounts] = await Promise.all([
    db
      .select({
        meetingV2Id: meetingsV2DocumentPages.meetingV2Id,
        pageCount: count(),
      })
      .from(meetingsV2DocumentPages)
      .where(inArray(meetingsV2DocumentPages.meetingV2Id, ids))
      .groupBy(meetingsV2DocumentPages.meetingV2Id),
    db
      .select({
        meetingV2Id: meetingsV3PageRewrites.meetingV2Id,
        correctedPageCount: count(),
      })
      .from(meetingsV3PageRewrites)
      .where(inArray(meetingsV3PageRewrites.meetingV2Id, ids))
      .groupBy(meetingsV3PageRewrites.meetingV2Id),
    db
      .select({
        meetingV2Id: meetingsV3AgendaItems.meetingV2Id,
        agendaItemCount: count(),
      })
      .from(meetingsV3AgendaItems)
      .where(inArray(meetingsV3AgendaItems.meetingV2Id, ids))
      .groupBy(meetingsV3AgendaItems.meetingV2Id),
  ]);
  const pagesByMeeting = new Map(pageCounts.map((row) => [row.meetingV2Id, Number(row.pageCount)]));
  const correctedByMeeting = new Map(
    correctedCounts.map((row) => [row.meetingV2Id, Number(row.correctedPageCount)]),
  );
  const agendaByMeeting = new Map(
    agendaCounts.map((row) => [row.meetingV2Id, Number(row.agendaItemCount)]),
  );

  return workspaces.map((row) => ({
    id: row.id,
    title: row.title,
    meetingDate: row.meetingDate,
    stage: meetingsV3PackageStage(row.settings),
    error: meetingsV3PackageError(row.settings),
    currentStep: row.currentStep,
    pageCount: pagesByMeeting.get(row.id) ?? 0,
    correctedPageCount: correctedByMeeting.get(row.id) ?? 0,
    agendaItemCount: agendaByMeeting.get(row.id) ?? 0,
  }));
}

/**
 * Package progress for one V3 meeting.
 * Returns null when the id is missing or is not a V3 workspace.
 */
export async function loadMeetingsV3PackageStatus(
  meetingId: string,
): Promise<MeetingsV3PackageStatus | null> {
  const db = getDb();
  const [meeting] = await db
    .select({
      id: meetingsV2.id,
      title: meetingsV2.title,
      meetingDate: meetingsV2.meetingDate,
      settings: meetingsV2.settings,
      currentStep: meetingsV2.currentStep,
    })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  if (!meeting || !isMeetingsV3Workspace(meeting.settings)) return null;

  const [pageRows, correctedCountRows, agendaCountRows] = await Promise.all([
    db
      .select({ pageNumber: meetingsV2DocumentPages.pageNumber })
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
    db
      .select({ correctedPageCount: count() })
      .from(meetingsV3PageRewrites)
      .where(eq(meetingsV3PageRewrites.meetingV2Id, meetingId)),
    db
      .select({ agendaItemCount: count() })
      .from(meetingsV3AgendaItems)
      .where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId)),
  ]);
  return {
    id: meeting.id,
    title: meeting.title,
    meetingDate: meeting.meetingDate,
    stage: meetingsV3PackageStage(meeting.settings),
    error: meetingsV3PackageError(meeting.settings),
    currentStep: meeting.currentStep,
    pageCount: pageRows.length,
    correctedPageCount: Number(correctedCountRows[0]?.correctedPageCount ?? 0),
    agendaItemCount: Number(agendaCountRows[0]?.agendaItemCount ?? 0),
  };
}

/**
 * The settings object stored on a new V3 meeting.
 */
export function meetingsV3CreatedSettings(
  createdAt: string,
  upcoming: { agendaContentEndsAtPage: number } | null,
): MeetingV2Settings {
  const v3Package: MeetingsV3PackageSettings = {
    workspace: true,
    stage: "created",
    error: null,
    updatedAt: createdAt,
  };
  return upcoming
    ? { upcomingMeeting: upcoming, v3Package }
    : { v3Package };
}

/**
 * Stores the package stage without dropping the rest of the meeting settings.
 */
export async function writeMeetingsV3PackageStage(
  meetingId: string,
  stage: MeetingsV3PackageStage,
  error: string | null,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(row?.settings);
  const updatedAt = new Date().toISOString();
  const next: MeetingsV3PackageSettings = {
    workspace: true,
    stage,
    error,
    updatedAt,
  };
  await db
    .update(meetingsV2)
    .set({
      settings: { ...settings, v3Package: next },
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}
