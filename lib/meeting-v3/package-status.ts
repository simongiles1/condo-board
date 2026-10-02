/**
 * Reads V3 package progress without starting extraction.
 */

import { count, desc, eq, inArray } from "drizzle-orm";
import path from "path";

import { getDb } from "@/lib/db";
import { loadMeetingBoardPackageMeta } from "@/lib/meeting-v2/board-package";
import {
  meetings,
  meetingsV2,
  meetingsV2DocumentPages,
  meetingsV3AgendaItems,
  meetingsV3PageRewrites,
} from "@/lib/db/schema";
import { readMeetingV2Settings, type MeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { upcomingAgendaSplit } from "@/lib/meeting-v2/upcoming-meeting";
import {
  isMeetingsV3Workspace,
  meetingsV3AttachmentLink,
  meetingsV3FactGrouping,
  meetingsV3FactResolution,
  meetingsV3MeetingReconciliation,
  meetingsV3MinutesDraft,
  meetingsV3MinutesValidation,
  meetingsV3PackageError,
  meetingsV3PackageStage,
  meetingsV3TranscriptSegmentation,
  type MeetingsV3AttachmentLink,
  type MeetingsV3FactGrouping,
  type MeetingsV3FactResolution,
  type MeetingsV3MeetingReconciliation,
  type MeetingsV3MinutesDraft,
  type MeetingsV3MinutesValidation,
  type MeetingsV3PackageSettings,
  type MeetingsV3TranscriptSegmentation,
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
  factsResolved: boolean;
  transcriptSegmented: boolean;
  factsGrouped: boolean;
  minutesValidated: boolean;
  minutesDrafted: boolean;
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
  factsResolved: boolean;
  factCount: number;
  unresolvedFactItemCount: number;
  transcriptSegmented: boolean;
  transcriptSpanCount: number;
  transcriptOverlapItemCount: number;
  factsGrouped: boolean;
  factGroupCount: number;
  ungroupedFactCount: number;
  conclusionsRecorded: boolean;
  minutesValidated: boolean;
  minutesDrafted: boolean;
  validationErrorCount: number;
  validationWarningCount: number;
  validationFindings: MeetingsV3MinutesValidation["findings"];
  hasTranscript: boolean;
  hasBoardPackage: boolean;
  transcriptFileName: string | null;
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
    factsResolved: meetingsV3FactResolution(row.settings) != null,
    transcriptSegmented: meetingsV3TranscriptSegmentation(row.settings) != null,
    factsGrouped: meetingsV3FactGrouping(row.settings) != null,
    minutesValidated: meetingsV3MinutesValidation(row.settings) != null,
    minutesDrafted: meetingsV3MinutesDraft(row.settings) != null,
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
  const factResolution = meetingsV3FactResolution(settings);
  const transcriptSegmentation = meetingsV3TranscriptSegmentation(settings);
  const factGrouping = meetingsV3FactGrouping(settings);
  const [legacy] = await db
    .select({ vttFilePath: meetings.vttFilePath })
    .from(meetings)
    .where(eq(meetings.id, meetingId));

  const [pageRows, correctedCountRows, agendaCountRows, boardPackageMeta] = await Promise.all([
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
    loadMeetingBoardPackageMeta(meetingId),
  ]);
  const transcriptPath = legacy?.vttFilePath?.trim() || null;
  const hasBoardPackage = boardPackageMeta.ok && boardPackageMeta.payload.available;
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
    factsResolved: factResolution != null,
    factCount: factResolution?.factCount ?? 0,
    unresolvedFactItemCount: factResolution?.unresolvedItemCount ?? 0,
    transcriptSegmented: transcriptSegmentation != null,
    transcriptSpanCount: transcriptSegmentation?.spanCount ?? 0,
    transcriptOverlapItemCount: transcriptSegmentation?.overlapItemCount ?? 0,
    factsGrouped: factGrouping != null,
    factGroupCount: factGrouping?.groupCount ?? 0,
    ungroupedFactCount: factGrouping?.ungroupedCount ?? 0,
    conclusionsRecorded: meetingsV3MeetingReconciliation(settings) != null,
    minutesValidated: meetingsV3MinutesValidation(settings) != null,
    minutesDrafted: meetingsV3MinutesDraft(settings) != null,
    validationErrorCount: meetingsV3MinutesValidation(settings)?.errorCount ?? 0,
    validationWarningCount: meetingsV3MinutesValidation(settings)?.warningCount ?? 0,
    validationFindings: meetingsV3MinutesValidation(settings)?.findings ?? [],
    hasTranscript: Boolean(transcriptPath),
    hasBoardPackage,
    transcriptFileName: transcriptPath ? path.basename(transcriptPath) : null,
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
    factResolution: meetingsV3FactResolution(settings),
    transcriptSegmentation: meetingsV3TranscriptSegmentation(settings),
    factGrouping: meetingsV3FactGrouping(settings),
    meetingReconciliation: meetingsV3MeetingReconciliation(settings),
    ...minutesFollowOn(settings, true),
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
 * Quoted facts and transcript spans are cleared because they belonged to the previous page link.
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
    // A new attachment link changes which pages a quote can come from.
    factResolution: null,
    transcriptSegmentation: null,
    factGrouping: null,
    meetingReconciliation: null,
    ...minutesFollowOn(settings, false),
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  return { ...settings, v3Package: next };
}

/**
 * Settings with the fact-resolution flag replaced.
 * The attachment link stays as it is. Source groups are cleared because they belonged to the previous facts.
 */
export function meetingsV3SettingsWithFactResolution(
  settings: MeetingV2Settings,
  factResolution: MeetingsV3FactResolution | null,
): MeetingV2Settings {
  const next: MeetingsV3PackageSettings = {
    workspace: true,
    stage: meetingsV3PackageStage(settings),
    error: meetingsV3PackageError(settings),
    updatedAt: settings.v3Package?.updatedAt ?? new Date().toISOString(),
    attachmentLink: meetingsV3AttachmentLink(settings),
    factResolution,
    transcriptSegmentation: meetingsV3TranscriptSegmentation(settings),
    factGrouping: null,
    meetingReconciliation: null,
    ...minutesFollowOn(settings, false),
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  return { ...settings, v3Package: next };
}

/**
 * Stores or clears the fact resolution without changing the package stage.
 */
export async function writeMeetingsV3FactResolution(
  meetingId: string,
  factResolution: MeetingsV3FactResolution | null,
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
      settings: meetingsV3SettingsWithFactResolution(settings, factResolution),
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
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

/**
 * Settings with the transcript-segmentation flag replaced.
 * Quoted facts stay as they are. Meeting conclusions are cleared because they belonged to the previous stretches.
 */
export function meetingsV3SettingsWithTranscriptSegmentation(
  settings: MeetingV2Settings,
  transcriptSegmentation: MeetingsV3TranscriptSegmentation | null,
): MeetingV2Settings {
  const next: MeetingsV3PackageSettings = {
    workspace: true,
    stage: meetingsV3PackageStage(settings),
    error: meetingsV3PackageError(settings),
    updatedAt: settings.v3Package?.updatedAt ?? new Date().toISOString(),
    attachmentLink: meetingsV3AttachmentLink(settings),
    factResolution: meetingsV3FactResolution(settings),
    transcriptSegmentation,
    factGrouping: meetingsV3FactGrouping(settings),
    meetingReconciliation: null,
    ...minutesFollowOn(settings, false),
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  return { ...settings, v3Package: next };
}

/**
 * Stores or clears the transcript segmentation without changing the package stage.
 */
export async function writeMeetingsV3TranscriptSegmentation(
  meetingId: string,
  transcriptSegmentation: MeetingsV3TranscriptSegmentation | null,
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
      settings: meetingsV3SettingsWithTranscriptSegmentation(settings, transcriptSegmentation),
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}

/**
 * Settings with the fact-grouping flag replaced.
 * Quoted facts and transcript spans stay as they are.
 */
export function meetingsV3SettingsWithFactGrouping(
  settings: MeetingV2Settings,
  factGrouping: MeetingsV3FactGrouping | null,
): MeetingV2Settings {
  const next: MeetingsV3PackageSettings = {
    workspace: true,
    stage: meetingsV3PackageStage(settings),
    error: meetingsV3PackageError(settings),
    updatedAt: settings.v3Package?.updatedAt ?? new Date().toISOString(),
    attachmentLink: meetingsV3AttachmentLink(settings),
    factResolution: meetingsV3FactResolution(settings),
    transcriptSegmentation: meetingsV3TranscriptSegmentation(settings),
    factGrouping,
    meetingReconciliation: meetingsV3MeetingReconciliation(settings),
    ...minutesFollowOn(settings, true),
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  return { ...settings, v3Package: next };
}

/**
 * Stores or clears the fact grouping without changing the package stage.
 */
export async function writeMeetingsV3FactGrouping(
  meetingId: string,
  factGrouping: MeetingsV3FactGrouping | null,
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
      settings: meetingsV3SettingsWithFactGrouping(settings, factGrouping),
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}

/**
 * Settings with the meeting-reconciliation flag replaced.
 * Quoted facts, transcript spans, and source links stay as they are.
 */
export function meetingsV3SettingsWithMeetingReconciliation(
  settings: MeetingV2Settings,
  meetingReconciliation: MeetingsV3MeetingReconciliation | null,
): MeetingV2Settings {
  const next: MeetingsV3PackageSettings = {
    workspace: true,
    stage: meetingsV3PackageStage(settings),
    error: meetingsV3PackageError(settings),
    updatedAt: settings.v3Package?.updatedAt ?? new Date().toISOString(),
    attachmentLink: meetingsV3AttachmentLink(settings),
    factResolution: meetingsV3FactResolution(settings),
    transcriptSegmentation: meetingsV3TranscriptSegmentation(settings),
    factGrouping: meetingsV3FactGrouping(settings),
    meetingReconciliation,
    ...minutesFollowOn(settings, false),
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  return { ...settings, v3Package: next };
}

function minutesFollowOn(
  settings: MeetingV2Settings,
  keep: boolean,
): Pick<MeetingsV3PackageSettings, "minutesValidation" | "minutesDraft"> {
  if (!keep) return { minutesValidation: null, minutesDraft: null };
  return {
    minutesValidation: meetingsV3MinutesValidation(settings),
    minutesDraft: meetingsV3MinutesDraft(settings),
  };
}

/**
 * Stores or clears the meeting reconciliation without changing the package stage.
 */
export async function writeMeetingsV3MeetingReconciliation(
  meetingId: string,
  meetingReconciliation: MeetingsV3MeetingReconciliation | null,
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
      settings: meetingsV3SettingsWithMeetingReconciliation(settings, meetingReconciliation),
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}

/**
 * Settings with the minutes-check flag replaced.
 * A new check clears the previous draft because that draft described the previous check.
 */
export function meetingsV3SettingsWithMinutesValidation(
  settings: MeetingV2Settings,
  minutesValidation: MeetingsV3MinutesValidation | null,
): MeetingV2Settings {
  const next: MeetingsV3PackageSettings = {
    workspace: true,
    stage: meetingsV3PackageStage(settings),
    error: meetingsV3PackageError(settings),
    updatedAt: settings.v3Package?.updatedAt ?? new Date().toISOString(),
    attachmentLink: meetingsV3AttachmentLink(settings),
    factResolution: meetingsV3FactResolution(settings),
    transcriptSegmentation: meetingsV3TranscriptSegmentation(settings),
    factGrouping: meetingsV3FactGrouping(settings),
    meetingReconciliation: meetingsV3MeetingReconciliation(settings),
    minutesValidation,
    minutesDraft: null,
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  return { ...settings, v3Package: next };
}

/**
 * Stores or clears the minutes check without changing the package stage.
 */
export async function writeMeetingsV3MinutesValidation(
  meetingId: string,
  minutesValidation: MeetingsV3MinutesValidation | null,
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
      settings: meetingsV3SettingsWithMinutesValidation(settings, minutesValidation),
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}

/**
 * Settings with the minutes-draft flag replaced.
 * The minutes check stays as it is.
 */
export function meetingsV3SettingsWithMinutesDraft(
  settings: MeetingV2Settings,
  minutesDraft: MeetingsV3MinutesDraft | null,
): MeetingV2Settings {
  const next: MeetingsV3PackageSettings = {
    workspace: true,
    stage: meetingsV3PackageStage(settings),
    error: meetingsV3PackageError(settings),
    updatedAt: settings.v3Package?.updatedAt ?? new Date().toISOString(),
    attachmentLink: meetingsV3AttachmentLink(settings),
    factResolution: meetingsV3FactResolution(settings),
    transcriptSegmentation: meetingsV3TranscriptSegmentation(settings),
    factGrouping: meetingsV3FactGrouping(settings),
    meetingReconciliation: meetingsV3MeetingReconciliation(settings),
    minutesValidation: meetingsV3MinutesValidation(settings),
    minutesDraft,
    aiUsage: settings.v3Package?.aiUsage ?? null,
  };
  return { ...settings, v3Package: next };
}

/**
 * Stores or clears the minutes draft without changing the package stage.
 */
export async function writeMeetingsV3MinutesDraft(
  meetingId: string,
  minutesDraft: MeetingsV3MinutesDraft | null,
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
      settings: meetingsV3SettingsWithMinutesDraft(settings, minutesDraft),
      updatedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
}
