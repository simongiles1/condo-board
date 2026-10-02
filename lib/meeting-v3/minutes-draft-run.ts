/**
 * Checks a reconciled V3 meeting and stores minutes in the V2 section order.
 * Each topic paragraph is written from the transcript stretch. Unverified figures stay off the page.
 */

import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2MinutesDrafts } from "@/lib/db/schema-v2";
import { readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { listMeetingV3Agenda } from "@/lib/meeting-v3/agenda-run";
import { DEEPSEEK_COMPLETION_MODEL, generateDeepSeekJson, type DeepSeekGenerationResult } from "@/lib/deepseek/client";
import {
  buildMeetingsV3DeepSeekStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import {
  assembleMeetingsV3Minutes,
  MEETINGS_V3_MINUTES_PROSE_PROMPT,
  meetingsV3ItemsNeedingMinutesProse,
  readMeetingsV3MinutesProse,
  type MeetingsV3DraftSourceItem,
} from "@/lib/meeting-v3/minutes-draft";
import { collectMeetingsV3ValidationFindings } from "@/lib/meeting-v3/minutes-validation";
import {
  writeMeetingsV3MinutesDraft,
  writeMeetingsV3MinutesValidation,
} from "@/lib/meeting-v3/package-status";
import {
  isMeetingsV3Workspace,
  meetingsV3MeetingReconciliation,
  meetingsV3MinutesDraft,
  meetingsV3MinutesValidation,
  type MeetingsV3ValidationFinding,
} from "@/lib/meeting-v3/workspace";

/** A minutes step the route can return with an HTTP status. */
export class MeetingsV3MinutesError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MeetingsV3MinutesError";
    this.status = status;
  }
}

/** The check stored for one meeting. */
export type MeetingsV3ValidationResult = {
  meetingId: string;
  errorCount: number;
  warningCount: number;
  findings: MeetingsV3ValidationFinding[];
};

/** The draft stored for one meeting. */
export type MeetingsV3DraftResult = {
  meetingId: string;
  draftId: string;
  title: string;
  markdown: string;
  openPointCount: number;
};

/**
 * Records open points from the current conclusions and fact reviews.
 * Throws MeetingsV3MinutesError when the meeting has not been reconciled.
 */
export async function validateMeetingV3Minutes(meetingId: string): Promise<MeetingsV3ValidationResult> {
  const items = await loadDraftSources(meetingId);
  const findings = collectMeetingsV3ValidationFindings(items);
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const completedAt = new Date().toISOString();
  await writeMeetingsV3MinutesValidation(meetingId, {
    completedAt,
    errorCount,
    warningCount,
    findings,
  });
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({
      currentStep: errorCount > 0
        ? "Minutes checked; open points remain"
        : "Minutes checked; no open points",
      updatedAt: completedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
  return { meetingId, errorCount, warningCount, findings };
}

/**
 * Stores a new minutes draft from the current check.
 * Open points stay in the draft. They are not printed as settled decisions.
 * Throws MeetingsV3MinutesError when the check has not been run.
 */
export async function draftMeetingV3Minutes(meetingId: string): Promise<MeetingsV3DraftResult> {
  const db = getDb();
  const [meeting] = await db
    .select({
      id: meetingsV2.id,
      title: meetingsV2.title,
      meetingDate: meetingsV2.meetingDate,
      settings: meetingsV2.settings,
    })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(meeting?.settings);
  if (!meeting || !isMeetingsV3Workspace(settings)) {
    throw new MeetingsV3MinutesError("Meeting not found.", 404);
  }
  const validation = meetingsV3MinutesValidation(settings);
  if (!validation) {
    throw new MeetingsV3MinutesError("Check the minutes before drafting them.", 409);
  }
  if (!meetingsV3MeetingReconciliation(settings)) {
    throw new MeetingsV3MinutesError("Reconcile the meeting before drafting minutes.", 409);
  }

  const items = await loadDraftSources(meetingId);
  const proseUsage = await writeMinutesProse(meetingId, items);
  const assembled = assembleMeetingsV3Minutes({
    title: meeting.title,
    meetingDate: meeting.meetingDate,
    items,
    openPointCount: validation.errorCount + validation.warningCount,
  });
  const completedAt = new Date().toISOString();
  const draftId = randomUUID();
  const title = `${meeting.title} draft`;
  await db.insert(meetingsV2MinutesDrafts).values({
    id: draftId,
    meetingV2Id: meetingId,
    format: "minutes_v3",
    title,
    contentMarkdown: assembled.markdown,
    summaryJson: JSON.stringify({
      assemblyMode: proseUsage.length > 0 ? "v3_minutes_prose" : "v3_minutes_fallback",
      openPointCount: validation.errorCount + validation.warningCount,
      warnings: assembled.warnings,
    }),
    modelName: proseUsage.length > 0 ? DEEPSEEK_COMPLETION_MODEL : "v3-minutes-fallback",
    usageJson: JSON.stringify({ agendaItemCount: items.length }),
    createdAt: completedAt,
    updatedAt: completedAt,
  });
  await writeMeetingsV3MinutesDraft(meetingId, {
    completedAt,
    draftId,
    openPointCount: validation.errorCount + validation.warningCount,
  });
  if (proseUsage.length > 0) {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3DeepSeekStageRow("v3_draft", proseUsage),
    );
  }
  await db
    .update(meetingsV2)
    .set({
      currentStep: validation.errorCount > 0
        ? "Working draft stored; open points remain"
        : "Minutes draft stored",
      updatedAt: completedAt,
    })
    .where(eq(meetingsV2.id, meetingId));
  return {
    meetingId,
    draftId,
    title,
    markdown: assembled.markdown,
    openPointCount: validation.errorCount + validation.warningCount,
  };
}

/**
 * The latest V3 minutes draft, or null when none is stored.
 */
export async function loadMeetingV3MinutesDraft(meetingId: string): Promise<{
  draftId: string;
  title: string;
  markdown: string;
  openPointCount: number;
} | null> {
  const db = getDb();
  const [meeting] = await db
    .select({ settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(meeting?.settings);
  if (!meeting || !isMeetingsV3Workspace(settings)) {
    throw new MeetingsV3MinutesError("Meeting not found.", 404);
  }
  const flag = meetingsV3MinutesDraft(settings);
  if (!flag) return null;
  const [row] = await db
    .select({
      id: meetingsV2MinutesDrafts.id,
      title: meetingsV2MinutesDrafts.title,
      contentMarkdown: meetingsV2MinutesDrafts.contentMarkdown,
    })
    .from(meetingsV2MinutesDrafts)
    .where(and(
      eq(meetingsV2MinutesDrafts.meetingV2Id, meetingId),
      eq(meetingsV2MinutesDrafts.format, "minutes_v3"),
      eq(meetingsV2MinutesDrafts.id, flag.draftId),
    ))
    .orderBy(desc(meetingsV2MinutesDrafts.createdAt))
    .limit(1);
  if (!row) return null;
  const openPointCount = flag.openPointCount;
  return {
    draftId: row.id,
    title: row.title,
    markdown: row.contentMarkdown,
    openPointCount,
  };
}

const PROSE_CONCURRENCY = 4;
const PROSE_DISCUSSION_LIMIT = 6000;

async function writeMinutesProse(
  meetingId: string,
  items: MeetingsV3DraftSourceItem[],
): Promise<DeepSeekGenerationResult[]> {
  const targets = meetingsV3ItemsNeedingMinutesProse(items).filter((item) => {
    const discussion = item.conclusion?.discussion.replace(/\s+/g, " ").trim() ?? "";
    return discussion.length >= 40;
  });
  const usage: DeepSeekGenerationResult[] = [];
  if (targets.length === 0) return usage;
  let finished = 0;
  await setDraftStep(meetingId, `Writing minutes 0 of ${targets.length}`);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < targets.length) {
      const index = next;
      next += 1;
      const item = targets[index];
      if (!item) continue;
      const summary = await requestMinutesProse(item, usage);
      if (summary) item.minutesSummary = summary;
      finished += 1;
      await setDraftStep(meetingId, `Writing minutes ${finished} of ${targets.length}`);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PROSE_CONCURRENCY, targets.length) }, () => worker()),
  );
  return usage;
}

async function requestMinutesProse(
  item: MeetingsV3DraftSourceItem,
  usage: DeepSeekGenerationResult[],
): Promise<string | null> {
  const discussion = (item.conclusion?.discussion ?? "").replace(/\s+/g, " ").trim().slice(0, PROSE_DISCUSSION_LIMIT);
  try {
    const response = await generateDeepSeekJson({
      systemInstruction: MEETINGS_V3_MINUTES_PROSE_PROMPT,
      userText: JSON.stringify({
        topic: item.title,
        outcome: item.conclusion?.status ?? "unclear",
        discussion,
        withheld: item.reviewIssues.map((issue) => issue.message),
      }),
      modelName: DEEPSEEK_COMPLETION_MODEL,
      temperature: 0,
      thinking: false,
      maxOutputTokens: 800,
    });
    usage.push(response);
    return readMeetingsV3MinutesProse(response.text);
  } catch (error) {
    console.error("[v3-minutes-prose]", item.itemNumber, error instanceof Error ? error.message : error);
    return null;
  }
}

async function setDraftStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}

async function loadDraftSources(meetingId: string): Promise<MeetingsV3DraftSourceItem[]> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(meeting?.settings);
  if (!meeting || !isMeetingsV3Workspace(settings)) {
    throw new MeetingsV3MinutesError("Meeting not found.", 404);
  }
  if (!meetingsV3MeetingReconciliation(settings)) {
    throw new MeetingsV3MinutesError("Reconcile the meeting before checking the minutes.", 409);
  }
  const items = await listMeetingV3Agenda(meetingId);
  if (items.length === 0) {
    throw new MeetingsV3MinutesError("Build the agenda before checking the minutes.", 409);
  }
  return items.map((item) => ({
    id: item.id,
    itemNumber: item.itemNumber,
    title: item.title,
    sectionLabel: item.sectionLabel,
    itemType: item.itemType,
    conclusion: item.conclusion,
    reviewIssues: item.facts?.reviewIssues ?? [],
  }));
}
