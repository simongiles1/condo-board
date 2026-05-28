import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { extractionSources, meetings } from "@/lib/db/schema";
import type {
  AgendaItemV2,
  MinutesDocumentV2,
} from "@/lib/minutes/schema-v2";

import { persistExtractionDocument } from "./persist";
import type { EmailExtractionDocument } from "./schema";

function collectAgendaItems(doc: MinutesDocumentV2): AgendaItemV2[] {
  const items: AgendaItemV2[] = [
    ...doc.specialPresentations,
    ...doc.financialMatters,
    ...doc.correspondence,
    ...doc.newOrOtherBusiness,
  ];

  for (const section of doc.postTerminationSections ?? []) {
    items.push(...section.items);
  }

  const mgmt = doc.managementReport;
  if (mgmt) {
    items.push(
      ...mgmt.itemsForRatification,
      ...mgmt.itemsForApproval,
      ...mgmt.itemsForInformation,
      ...mgmt.itemsForDiscussion,
    );
  }

  return items;
}

function walkAgendaItems(
  items: AgendaItemV2[],
  doc: EmailExtractionDocument,
): void {
  for (const item of items) {
    if (item.costMentioned != null || item.contractorMentioned) {
      doc.maintenance_events?.push({
        equipment: item.topic,
        action: item.status ?? "mentioned",
        vendor: item.contractorMentioned,
        cost: item.costMentioned,
        description: item.summary,
      });
    }

    if (item.costMentioned != null) {
      doc.budget_line_items?.push({
        category: item.topic,
        actual_amount: item.costMentioned,
        source_quote: item.summary,
      });
    }

    for (const action of item.actionItems ?? []) {
      doc.action_items?.push({
        assignee: action.assignee,
        task: action.taskDescription,
      });
    }

    walkAgendaItems(item.subItems ?? [], doc);
  }
}

function minutesToExtraction(minutes: MinutesDocumentV2): EmailExtractionDocument {
  const doc: EmailExtractionDocument = {
    document_type: "meeting_minutes",
    summary: minutes.metadata?.corporationName
      ? `Meeting minutes for ${minutes.metadata.corporationName}`
      : "Meeting minutes",
    action_items: [],
    maintenance_events: [],
    budget_line_items: [],
    meetings: [],
    entities: [],
  };

  if (minutes.metadata?.meetingDate) {
    doc.meetings?.push({
      type: "board",
      date: minutes.metadata.meetingDate,
      time: minutes.metadata.meetingTime,
      location: minutes.metadata.meetingLocation,
    });
  }

  walkAgendaItems(collectAgendaItems(minutes), doc);

  return doc;
}

export async function bridgeMeetingToKnowledgeBase(
  meetingId: string,
): Promise<{ sourceId: string; bridged: boolean }> {
  const db = getDb();
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, meetingId));

  if (!meeting || meeting.status !== "finalized" || !meeting.minutesJson) {
    return { sourceId: "", bridged: false };
  }

  const existing = await db
    .select()
    .from(extractionSources)
    .where(eq(extractionSources.sourceId, meetingId))
    .limit(1);

  if (existing.length) {
    return { sourceId: existing[0].id, bridged: false };
  }

  const parsed = JSON.parse(meeting.minutesJson) as
    | MinutesDocumentV2
    | { data?: MinutesDocumentV2 };
  const minutes =
    "data" in parsed && parsed.data ? parsed.data : (parsed as MinutesDocumentV2);

  const document = minutesToExtraction(minutes);
  const sourceId = randomUUID();
  const now = new Date().toISOString();

  await db.insert(extractionSources).values({
    id: sourceId,
    sourceType: "meeting",
    sourceId: meetingId,
    emailThreadId: null,
    processedAt: now,
    modelName: "meeting_pipeline",
    extractionVersion: 1,
    contentHash: null,
    rawExtractionJson: JSON.stringify(document),
    aiUsageJson: meeting.aiUsageJson,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: "0",
  });

  await persistExtractionDocument({
    sourceId,
    document,
  });

  return { sourceId, bridged: true };
}

export async function bridgeAllFinalizedMeetings(): Promise<number> {
  const db = getDb();
  const finalized = await db
    .select()
    .from(meetings)
    .where(eq(meetings.status, "finalized"));

  let count = 0;
  for (const meeting of finalized) {
    const result = await bridgeMeetingToKnowledgeBase(meeting.id);
    if (result.bridged) count++;
  }
  return count;
}
