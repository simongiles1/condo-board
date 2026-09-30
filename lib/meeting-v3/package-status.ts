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
import { upcomingAgendaSplit } from "@/lib/meeting-v2/upcoming-meeting";
import {
  isMeetingsV3Workspace,
  meetingsV3AttachmentLink,
  meetingsV3PackageError,
  meetingsV3PackageStage,
  type MeetingsV3AttachmentLink,
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
  agendaContentEndsAtPage: number | null;
  attachmentsLinked: boolean;
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
  agendaContentEndsAtPage: number | null;
  attachmentsLinked: boolean;
  unassignedAttachmentPages: number[];
  attachmentPagesWithoutText: number[];
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
    agendaContentEndsAtPage: upcomingAgendaSplit(readMeetingV2Settings(row.settings)),
    attachmentsLinked: meetingsV3AttachmentLink(row.settings) != null,
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
  const settings = readMeetingV2Settings(meeting.settings);
  const attachmentLink = meetingsV3AttachmentLink(settings);

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
    agendaContentEndsAtPage: upcomingAgendaSplit(settings),
    attachmentsLinked: attachmentLink != null,
    unassignedAttachmentPages: attachmentLink?.unassignedPages ?? [],
    attachmentPagesWithoutText: attachmentLink?.pagesWithoutText ?? [],
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
    attachmentLink: meetingsV3AttachmentLink(settings),
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  await db
    .update(meetingsV2)
    .set({
      settings: { ...settings, v3Package: next },
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}

/**
 * Settings with the attachment-link flag replaced.
 * Other V3 package fields stay as they are.
 */
export function meetingsV3SettingsWithAttachmentLink(
  settings: MeetingV2Settings,
  attachmentLink: MeetingsV3AttachmentLink | null,
): MeetingV2Settings {
  const next: MeetingsV3PackageSettings = {
    workspace: true,
    stage: meetingsV3PackageStage(settings),
    error: meetingsV3PackageError(settings),
    updatedAt: settings.v3Package?.updatedAt ?? new Date().toISOString(),
    attachmentLink,
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  return { ...settings, v3Package: next };
}

/**
 * Stores or clears the attachment link without changing the package stage.
 */
export async function writeMeetingsV3AttachmentLink(
  meetingId: string,
  attachmentLink: MeetingsV3AttachmentLink | null,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(row?.settings);
  const updatedAt = new Date().toISOString();
  await db
    .update(meetingsV2)
    .set({
      settings: meetingsV3SettingsWithAttachmentLink(settings, attachmentLink),
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}
