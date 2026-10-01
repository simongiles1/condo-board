/**
 * Groups accepted V3 facts that share one package quote.
 * V2 fact resolution is not written.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2DocumentPages, meetingsV3AgendaItems } from "@/lib/db/schema-v2";
import { generateDeepSeekJson, type DeepSeekGenerationResult } from "@/lib/deepseek/client";
import { isDeepSeekKeyConfigured, readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { listMeetingV3Agenda, type MeetingsV3AgendaItem } from "@/lib/meeting-v3/agenda-run";
import { readAgendaSourcePages } from "@/lib/meeting-v3/agenda-pages";
import {
  buildMeetingsV3DeepSeekStageRow,
  buildMeetingsV3NotApplicableStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import { readStoredItemFacts } from "@/lib/meeting-v3/facts";
import {
  acceptFactGroups,
  readProposedFactGroups,
  type MeetingsV3ItemFactGroups,
  type MeetingsV3ProposedFactGroup,
} from "@/lib/meeting-v3/fact-groups";
import { writeMeetingsV3FactGrouping } from "@/lib/meeting-v3/package-status";
import { listMeetingPageRewrites } from "@/lib/meeting-v3/page-rewrite-run";
import {
  isMeetingsV3Workspace,
  meetingsV3FactResolution,
  meetingsV3TranscriptSegmentation,
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

/** Output budget for one topic's source groups. */
const FACT_GROUP_MAX_OUTPUT_TOKENS = 8192;

const FACT_GROUP_PROMPT = `You group accepted facts that belong to the same bid or statement on a condominium board package page.
Return JSON only: {"items":[{"agendaItemId":"<id>","groups":[{"page":14,"quote":"<verbatim words from that page>","members":[{"field":"amount"|"vendor"|"recommendation"|"date","value":"<as listed>"}]}]}]}.
Rules:
- Use only agendaItemId, page, field, and value from the input facts. Do not add a fact.
- quote is copied from that page and must contain every member value.
- One group is one bidder, one recommendation, or one dated statement. A second bidder is a second group.
- A fact that does not share a quote with another fact is omitted.
- Omit a group that would have only one fact.`;

/**
 * Replaces source groups on the V3 agenda.
 * A quote that is not on the named page is dropped. A fact that does not share a quote stays ungrouped.
 * Throws FactGroupingError when the meeting, facts, or transcript segmentation is not ready.
 * A model failure leaves the previous groups in place.
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
  if (!meetingsV3TranscriptSegmentation(settings)) {
    throw new FactGroupingError("Segment the transcript before grouping sources.", 409);
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

  const [storedPages, rewrites] = await Promise.all([
    db
      .select({
        pageNumber: meetingsV2DocumentPages.pageNumber,
        extractedText: meetingsV2DocumentPages.extractedText,
      })
      .from(meetingsV2DocumentPages)
      .where(eq(meetingsV2DocumentPages.meetingV2Id, meetingId)),
    listMeetingPageRewrites(meetingId),
  ]);
  const textByPage = new Map<number, string>();
  for (const page of storedPages) {
    const extracted = page.extractedText?.trim() ?? "";
    if (extracted) textByPage.set(page.pageNumber, extracted);
  }
  for (const page of rewrites) {
    const corrected = page.correctedText.trim();
    if (corrected) textByPage.set(page.pageNumber, corrected);
  }

  const items = itemRows.map((item) => {
    const facts = readStoredItemFacts(item.factsJson);
    const sourcePages = readAgendaSourcePages(item.sourcePagesJson);
    const factPages = new Set(facts?.candidates.map((candidate) => candidate.page) ?? []);
    const pages = sourcePages
      .filter((pageNumber) => factPages.has(pageNumber))
      .map((pageNumber) => ({ pageNumber, text: textByPage.get(pageNumber) ?? "" }))
      .filter((page) => page.text.length > 0);
    return {
      id: item.id,
      itemNumber: item.itemNumber,
      title: item.title,
      pages,
      facts,
    };
  });
  const withGroups = items.filter((item) => (item.facts?.candidates.length ?? 0) >= 2 && item.pages.length > 0);
  const proposedByItem = new Map<string, MeetingsV3ProposedFactGroup[]>();
  const deepSeekUsage: DeepSeekGenerationResult[] = [];

  if (withGroups.length > 0) {
    if (!isDeepSeekKeyConfigured()) {
      throw new FactGroupingError("DEEPSEEK_API_KEY is required to group facts by source.", 409);
    }
    await setGroupStep(meetingId, "Grouping quoted facts by source");
    try {
      for (const item of withGroups) {
        const groups = await requestItemGroups(item, deepSeekUsage);
        proposedByItem.set(item.id, groups);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fact grouping failed.";
      await setGroupStep(meetingId, "Fact grouping failed");
      throw new FactGroupingError(message, 502);
    }
  }

  const groupsByItem = new Map<string, MeetingsV3ItemFactGroups>();
  let groupCount = 0;
  let ungroupedCount = 0;
  for (const item of items) {
    const grouped = acceptFactGroups({
      pages: item.pages,
      candidates: item.facts?.candidates ?? [],
      proposed: proposedByItem.get(item.id) ?? [],
    });
    groupsByItem.set(item.id, grouped);
    groupCount += grouped.groups.length;
    ungroupedCount += grouped.ungrouped.length;
  }

  const completedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const item of items) {
      const grouped = groupsByItem.get(item.id);
      await tx
        .update(meetingsV3AgendaItems)
        .set({
          factGroupsJson: JSON.stringify({
            groups: (grouped?.groups ?? []).map((group) => ({
              page: group.page,
              quote: group.quote,
              members: group.members,
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
      ? "Sources grouped; some figures do not share a quote"
      : groupCount > 0
        ? "Quoted facts grouped by source"
        : "No quoted facts shared a source",
  );

  if (deepSeekUsage.length > 0) {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3DeepSeekStageRow("v3_sources", deepSeekUsage),
    );
  } else {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3NotApplicableStageRow("v3_sources", {
        modelName: "N/A",
        usageDetail: "No topic had two quoted facts to group.",
      }),
    );
  }

  return {
    meetingId,
    groupCount,
    ungroupedCount,
    items: await listMeetingV3Agenda(meetingId),
  };
}

type GroupSourceItem = {
  id: string;
  itemNumber: string;
  title: string;
  pages: Array<{ pageNumber: number; text: string }>;
  facts: ReturnType<typeof readStoredItemFacts>;
};

async function requestItemGroups(
  item: GroupSourceItem,
  deepSeekUsage: DeepSeekGenerationResult[],
): Promise<MeetingsV3ProposedFactGroup[]> {
  const response = await generateDeepSeekJson({
    systemInstruction: FACT_GROUP_PROMPT,
    userText: JSON.stringify({
      items: [
        {
          agendaItemId: item.id,
          itemNumber: item.itemNumber,
          title: item.title,
          facts: (item.facts?.candidates ?? []).map((fact) => ({
            field: fact.field,
            value: fact.value,
            page: fact.page,
          })),
          pages: item.pages.map((page) => ({
            pageNumber: page.pageNumber,
            // CONCERN: a quote past this cut cannot tie facts that sit later on a long page.
            text: page.text.slice(0, 6000),
          })),
        },
      ],
    }),
    modelName: "deepseek-v4-flash",
    temperature: 0,
    thinking: false,
    maxOutputTokens: FACT_GROUP_MAX_OUTPUT_TOKENS,
  });
  deepSeekUsage.push(response);
  return readProposedFactGroups(response.text).flatMap((entry) =>
    entry.agendaItemId === item.id ? entry.groups : [],
  );
}

async function setGroupStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}
