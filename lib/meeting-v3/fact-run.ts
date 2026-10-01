/**
 * Resolves package facts for a V3 agenda from page quotes.
 * V2 fact resolution and the V2 agenda are not written.
 */

import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2, meetingsV2DocumentPages, meetingsV3AgendaItems } from "@/lib/db/schema-v2";
import { generateDeepSeekJson, type DeepSeekGenerationResult } from "@/lib/deepseek/client";
import { isDeepSeekKeyConfigured, readMeetingV2Settings } from "@/lib/meeting-v2/extraction-diagnostics";
import { listMeetingV3Agenda, type MeetingsV3AgendaItem } from "@/lib/meeting-v3/agenda-run";
import { readAgendaSourcePages } from "@/lib/meeting-v3/agenda-pages";
import {
  acceptQuotedFacts,
  chunkFactPages,
  FACT_RESOLUTION_MAX_OUTPUT_TOKENS,
  readProposedFacts,
  type MeetingsV3ItemFacts,
  type MeetingsV3ProposedFact,
} from "@/lib/meeting-v3/facts";
import {
  buildMeetingsV3DeepSeekStageRow,
  buildMeetingsV3NotApplicableStageRow,
  persistMeetingsV3AiUsageStage,
} from "@/lib/meeting-v3/ai-usage";
import { listMeetingPageRewrites } from "@/lib/meeting-v3/page-rewrite-run";
import { writeMeetingsV3FactResolution } from "@/lib/meeting-v3/package-status";
import { meetingsV3AttachmentLink, isMeetingsV3Workspace } from "@/lib/meeting-v3/workspace";

/** A fact resolution the route can return with an HTTP status. */
export class FactResolutionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FactResolutionError";
    this.status = status;
  }
}

/** The facts stored for one meeting. */
export type FactResolutionResult = {
  meetingId: string;
  factCount: number;
  unresolvedItemCount: number;
  items: MeetingsV3AgendaItem[];
};

const FACT_RESOLUTION_PROMPT = `You extract facts a condominium board package states for each agenda item.
Return JSON only: {"items":[{"agendaItemId":"<id>","facts":[{"field":"amount"|"vendor"|"recommendation"|"date","value":"<as printed>","page":14,"quote":"<verbatim words from that page>"}]}]}.
Rules:
- Use only agendaItemId and page values from the input.
- quote must be copied from that page's text. value must appear inside quote.
- amount is a dollar figure the page states as a cost or bid.
- vendor is a company named as a bidder or contractor.
- recommendation is management's recommended action, only when the page states one.
- date is a date the page states for that item.
- Return every distinct amount or vendor on the item's pages. Do not pick one when they differ.
- quote is the shortest sentence on that page that contains the value.
- Omit a field the pages do not state. Do not use a summary that is not in the page text.`;

/**
 * Replaces quoted facts on the V3 agenda.
 * A quote that is not on the named page is dropped. Two different values stay unresolved.
 * Throws FactResolutionError when the meeting, agenda, or attachment link is not ready.
 * A model failure leaves the previous facts in place.
 */
export async function resolveMeetingV3Facts(meetingId: string): Promise<FactResolutionResult> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetingsV2.id, settings: meetingsV2.settings })
    .from(meetingsV2)
    .where(eq(meetingsV2.id, meetingId));
  const settings = readMeetingV2Settings(meeting?.settings);
  if (!meeting || !isMeetingsV3Workspace(settings)) {
    throw new FactResolutionError("Meeting not found.", 404);
  }
  if (!meetingsV3AttachmentLink(settings)) {
    throw new FactResolutionError("Link attachment pages before resolving facts.", 409);
  }

  const itemRows = await db
    .select({
      id: meetingsV3AgendaItems.id,
      itemNumber: meetingsV3AgendaItems.itemNumber,
      title: meetingsV3AgendaItems.title,
      sourcePagesJson: meetingsV3AgendaItems.sourcePagesJson,
    })
    .from(meetingsV3AgendaItems)
    .where(eq(meetingsV3AgendaItems.meetingV2Id, meetingId))
    .orderBy(asc(meetingsV3AgendaItems.sortOrder));
  if (itemRows.length === 0) {
    throw new FactResolutionError("Build the agenda before resolving facts.", 409);
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
    const sourcePages = readAgendaSourcePages(item.sourcePagesJson);
    const pages = sourcePages
      .map((pageNumber) => ({ pageNumber, text: textByPage.get(pageNumber) ?? "" }))
      .filter((page) => page.text.length > 0);
    return {
      id: item.id,
      itemNumber: item.itemNumber,
      title: item.title,
      pages,
    };
  });
  const withText = items.filter((item) => item.pages.length > 0);
  const proposedByItem = new Map<string, MeetingsV3ProposedFact[]>();
  const deepSeekUsage: DeepSeekGenerationResult[] = [];

  if (withText.length > 0) {
    if (!isDeepSeekKeyConfigured()) {
      throw new FactResolutionError("DEEPSEEK_API_KEY is required to resolve facts from package pages.", 409);
    }
    await setFactStep(meetingId, "Resolving quoted facts from package pages");
    try {
      for (const item of withText) {
        for (const pages of chunkFactPages(item.pages)) {
          const facts = await requestItemFacts(item, pages, deepSeekUsage);
          const prior = proposedByItem.get(item.id) ?? [];
          proposedByItem.set(item.id, [...prior, ...facts]);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fact resolution failed.";
      await setFactStep(meetingId, "Fact resolution failed");
      throw new FactResolutionError(message, 502);
    }
  }

  const factsByItem = new Map<string, MeetingsV3ItemFacts>();
  let factCount = 0;
  let unresolvedItemCount = 0;
  for (const item of items) {
    const facts = acceptQuotedFacts({
      pages: item.pages,
      proposed: proposedByItem.get(item.id) ?? [],
    });
    factsByItem.set(item.id, facts);
    factCount += facts.candidates.length;
    if (facts.unresolvedFields.length > 0) unresolvedItemCount += 1;
  }

  const completedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(meetingsV3AgendaItems)
        .set({ factsJson: JSON.stringify(factsByItem.get(item.id)) })
        .where(eq(meetingsV3AgendaItems.id, item.id));
    }
  });
  await writeMeetingsV3FactResolution(meetingId, {
    completedAt,
    factCount,
    unresolvedItemCount,
  });
  await setFactStep(
    meetingId,
    unresolvedItemCount > 0
      ? "Quoted facts stored; some items have more than one value"
      : factCount > 0
        ? "Quoted facts stored from package pages"
        : "No quoted facts on the linked pages",
  );

  if (deepSeekUsage.length > 0) {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3DeepSeekStageRow("v3_facts", deepSeekUsage),
    );
  } else {
    await persistMeetingsV3AiUsageStage(
      meetingId,
      buildMeetingsV3NotApplicableStageRow("v3_facts", {
        modelName: "N/A",
        usageDetail: "Linked pages had no text to resolve.",
      }),
    );
  }

  return {
    meetingId,
    factCount,
    unresolvedItemCount,
    items: await listMeetingV3Agenda(meetingId),
  };
}

type FactSourceItem = {
  id: string;
  itemNumber: string;
  title: string;
  pages: Array<{ pageNumber: number; text: string }>;
};

async function requestItemFacts(
  item: FactSourceItem,
  pages: FactSourceItem["pages"],
  deepSeekUsage: DeepSeekGenerationResult[],
): Promise<MeetingsV3ProposedFact[]> {
  if (pages.length === 0) return [];
  try {
    const response = await generateDeepSeekJson({
      systemInstruction: FACT_RESOLUTION_PROMPT,
      userText: JSON.stringify({
        items: [
          {
            agendaItemId: item.id,
            itemNumber: item.itemNumber,
            title: item.title,
            pages: pages.map((page) => ({
              pageNumber: page.pageNumber,
              text: page.text.slice(0, 2500),
            })),
          },
        ],
      }),
      modelName: "deepseek-v4-flash",
      temperature: 0,
      thinking: false,
      maxOutputTokens: FACT_RESOLUTION_MAX_OUTPUT_TOKENS,
    });
    deepSeekUsage.push(response);
    return readProposedFacts(response.text).flatMap((entry) =>
      entry.agendaItemId === item.id ? entry.facts : [],
    );
  } catch (error) {
    if (!isTruncatedDeepSeekOutput(error) || pages.length < 2) throw error;
    const mid = Math.ceil(pages.length / 2);
    const left = await requestItemFacts(item, pages.slice(0, mid), deepSeekUsage);
    const right = await requestItemFacts(item, pages.slice(mid), deepSeekUsage);
    return [...left, ...right];
  }
}

function isTruncatedDeepSeekOutput(error: unknown): boolean {
  return error instanceof Error && error.message.includes("finish_reason=length");
}

async function setFactStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}
