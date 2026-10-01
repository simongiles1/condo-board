/**
 * Links accepted V3 facts that name the same project or proposal.
 * V2 fact resolution is not written. The transcript is not read.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV3AgendaItems } from "@/lib/db/schema-v2";
import { readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { listMeetingV3Agenda, type MeetingsV3AgendaItem } from "@/lib/meeting-v3/agenda-run";
import {
  buildMeetingsV3NotApplicableStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import { readStoredItemFacts } from "@/lib/meeting-v3/facts";
import type { MeetingsV3ItemFactGroups } from "@/lib/meeting-v3/fact-groups";
import { linkFactStatements } from "@/lib/meeting-v3/fact-statements";
import { writeMeetingsV3FactGrouping } from "@/lib/meeting-v3/package-status";
import {
  isMeetingsV3Workspace,
  meetingsV3FactResolution,
} from "@/lib/meeting-v3/workspace";

/** A grouping the route can return with an HTTP status. */
export class FactGroupingError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FactGroupingError";
    this.status = status;
  }
}

/** The groups stored for one meeting. */
export type FactGroupingResult = {
  meetingId: string;
  groupCount: number;
  ungroupedCount: number;
  items: MeetingsV3AgendaItem[];
};

/**
 * Replaces source links on the V3 agenda.
 * A fact joins a statement only when it names the same subject, and the same revision when more than one date is present.
 * Throws FactGroupingError when the meeting or facts are not ready.
 */
export async function groupMeetingV3Facts(meetingId: string): Promise<FactGroupingResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(meeting?.settings);
  if (!meeting || !isMeetingsV3Workspace(settings)) {
    throw new FactGroupingError("Meeting not found.", 404);
  }
  if (!meetingsV3FactResolution(settings)) {
    throw new FactGroupingError("Resolve quoted facts before grouping sources.", 409);
  }

  const itemRows = await db
    .select({
      id: meetingsV3AgendaItems.id,
      itemNumber: meetingsV3AgendaItems.itemNumber,
      title: meetingsV3AgendaItems.title,
      sourcePagesJson: meetingsV3AgendaItems.sourcePagesJson,
      factsJson: meetingsV3AgendaItems.factsJson,
    })
    .from(meetingsV3AgendaItems)
    .where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3AgendaItems.sortOrder));
  if (itemRows.length === 0) {
    throw new FactGroupingError("Build the agenda before grouping sources.", 409);
  }

  const items = itemRows.map((item) => ({
    id: item.id,
    facts: readStoredItemFacts(item.factsJson),
  }));
  await setGroupStep(meetingId, "Linking quoted facts by project");

  const groupsByItem = new Map<string, MeetingsV3ItemFactGroups>();
  let groupCount = 0;
  let ungroupedCount = 0;
  for (const item of items) {
    const linked = linkFactStatements(item.facts?.candidates ?? []);
    const grouped: MeetingsV3ItemFactGroups = {
      groups: [],
      statements: linked.statements,
      ungrouped: linked.unlinked,
    };
    groupsByItem.set(item.id, grouped);
    groupCount += linked.statements.length;
    ungroupedCount += linked.unlinked.length;
  }

  const completedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const item of items) {
      const grouped = groupsByItem.get(item.id);
      await tx
        .update(meetingsV3AgendaItems)
        .set({
          factGroupsJson: JSON.stringify({
            statements: (grouped?.statements ?? []).map((statement) => ({
              subject: statement.subject,
              revision: statement.revision,
              members: statement.members,
            })),
          }),
        })
        .where(eq(meetingsV3AgendaItems.id, item.id));
    }
  });
  await writeMeetingsV3FactGrouping(meetingId, {
    completedAt,
    groupCount,
    ungroupedCount,
  });
  await setGroupStep(
    meetingId,
    ungroupedCount > 0
      ? "Sources linked; some figures do not name a project"
      : groupCount > 0
        ? "Quoted facts linked by project"
        : "No quoted facts named a project",
  );

  await persistMeetingsV3AiUsageStage(
    meetingId,
    buildMeetingsV3NotApplicableStageRow("v3_sources", {
      modelName: "N/A",
      usageDetail: "Project links are read from the quoted facts. No model call.",
    }),
  );

  return {
    meetingId,
    groupCount,
    ungroupedCount,
    items: await listMeetingV3Agenda(meetingId),
  };
}

async function setGroupStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}
