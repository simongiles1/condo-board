/**
 * Reads V3 package progress without starting extraction.
 */

import { count, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2DocumentPages, meetingsV3QuoteRows } from "@/lib/db/schema-v2";
import { readMeetingV2Settings, type MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { upcomingAgendaSplit } from "@/lib/meeting-v2/upcoming-meeting";
import {
  quoteLedgerPageNumbers,
  quoteLedgerTruncated,
} from "@/lib/meeting-v3/quote-ledger";
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
  quoteRowCount: number;
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
  quoteRowCount: number;
  agendaContentEndsAtPage: number | null;
  ledgerPageNumbers: number[];
  truncated: boolean;
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
  const [pageCounts, quoteCounts] = await Promise.all([
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
        meetingV2Id: meetingsV3QuoteRows.meetingV2Id,
        quoteRowCount: count(),
      })
      .from(meetingsV3QuoteRows)
      .where(inArray(meetingsV3QuoteRows.meetingV2Id, ids))
      .groupBy(meetingsV3QuoteRows.meetingV2Id),
  ]);
  const pagesByMeeting = new Map(pageCounts.map((row) => [row.meetingV2Id, Number(row.pageCount)]));
  const quotesByMeeting = new Map(quoteCounts.map((row) => [row.meetingV2Id, Number(row.quoteRowCount)]));

  return workspaces.map((row) => ({
    id: row.id,
    title: row.title,
    meetingDate: row.meetingDate,
    stage: meetingsV3PackageStage(row.settings),
    error: meetingsV3PackageError(row.settings),
    currentStep: row.currentStep,
    pageCount: pagesByMeeting.get(row.id) ?? 0,
    quoteRowCount: quotesByMeeting.get(row.id) ?? 0,
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

  const [pageRows, quoteCountRows] = await Promise.all([
    db
      .select({ pageNumber: meetingsV2DocumentPages.pageNumber })
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
    db
      .select({ quoteRowCount: count() })
      .from(meetingsV3QuoteRows)
      .where(eq(meetingsV3QuoteRows.meetingV2Id, meetingId)),
  ]);
  const pageNumbers = pageRows.map((row) => row.pageNumber);
  const split = upcomingAgendaSplit(meeting.settings);
  return {
    id: meeting.id,
    title: meeting.title,
    meetingDate: meeting.meetingDate,
    stage: meetingsV3PackageStage(meeting.settings),
    error: meetingsV3PackageError(meeting.settings),
    currentStep: meeting.currentStep,
    pageCount: pageNumbers.length,
    quoteRowCount: Number(quoteCountRows[0]?.quoteRowCount ?? 0),
    agendaContentEndsAtPage: split,
    ledgerPageNumbers: quoteLedgerPageNumbers(pageNumbers, split),
    truncated: quoteLedgerTruncated(pageNumbers, split),
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
