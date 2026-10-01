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
  applyOrganizationMatches,
  chunkFactPages,
  expandFactPagesForPrompt,
  FACT_RESOLUTION_MAX_OUTPUT_TOKENS,
  FACT_RESOLUTION_REQUEST_TIMEOUT_MS,
  FACT_RESOLUTION_STALL_MS,
  FACT_RECOVERY_MAX_ISSUES,
  factRequestShouldSplit,
  factSliceShouldDivide,
  formatFactResolutionProgress,
  mergeProposedFacts,
  readProposedFacts,
  type MeetingsV3ItemFacts,
  type MeetingsV3ProposedFact,
} from "@/lib/meeting-v3/facts";
import { loadOrgMentionSearchDocuments } from "@/lib/organizations/mention-resolve";
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
Return JSON only: {"items":[{"agendaItemId":"<id>","facts":[{"field":"amount"|"vendor"|"recommendation"|"date","value":"<as printed>","page":14,"quote":"<verbatim words from that page that contain the value>","headingQuote":"<verbatim heading on that page, or omit>","rowQuote":"<verbatim table row or fee line, or omit>","conditionQuote":"<verbatim nearby tax, exclusion, or per-visit sentence, or omit>","subject":"<project name copied from the quote or headingQuote, or omit>","service":"<what an amount pays for, copied from the quote or rowQuote, or omit>","bidder":"<company that offered this amount, copied from the quote or rowQuote, or omit>","option":"<option or alternate label copied from the quote or rowQuote, or omit>","basis":"fixed"|"per_visit","role":"proposal"|"recommendation"|"reported_prior_approval"|"historical_event","qualifications":"<tax, exclusion, or condition copied from the quote or conditionQuote, or omit>"}]}]}.
Rules:
- Use only agendaItemId and page values from the input.
- quote must be copied from that page's text. value must appear inside quote.
- headingQuote, rowQuote, and conditionQuote must be copied from that same page. Omit a span the page does not contain.
- subject may come from the heading. service, bidder, and option may come from the row. qualifications may come from the condition. Omit a field none of those spans state.
- basis per_visit only when the quote or conditionQuote states a per-visit rate. basis fixed only when one of them says the fee is fixed. Otherwise omit basis.
- role proposal only when the value quote says this is a proposal or bid.
- role recommendation only when the value quote states a recommendation.
- role reported_prior_approval only when the value quote says the board or management already approved it. That records what the package reports. It is not a decision of this meeting.
- role historical_event only when the value quote describes a past incident or event, such as an incident date.
- Do not decide what this meeting ratified, deferred, or discussed.
- amount is a dollar figure the page states as a cost, bid, or rate.
- vendor is the company name as printed. Do not merge aliases.
- recommendation is management's recommended action, only when the page states one.
- date is a date the quote states. Do not relabel an incident date as an approval date.
- Return every distinct amount, including two equal amounts for different services. Do not collapse them.
- Two bidders for the same work both stay, each with its own bidder. They are alternatives, not one conflicting price. Do not pick a winner.
- otherTopicsOnThesePages are different items. Do not return their facts for this agendaItemId.
- quote is the shortest passage that contains the value. Put the project, the row, and the condition in their own fields.
- Omit a field the pages do not state. Do not use a summary that is not in the page text.`;

const FACT_RECOVERY_PROMPT = `You repair package facts that failed validation for one agenda item.
Return JSON only: {"items":[{"agendaItemId":"<id>","facts":[{"field":"amount"|"vendor"|"recommendation"|"date","value":"<as printed>","page":14,"quote":"<verbatim>","headingQuote":"<verbatim or omit>","rowQuote":"<verbatim or omit>","conditionQuote":"<verbatim or omit>","subject":"<or omit>","service":"<or omit>","bidder":"<or omit>","option":"<or omit>","basis":"fixed"|"per_visit","role":"proposal"|"recommendation"|"reported_prior_approval"|"historical_event","qualifications":"<or omit>","omit":true}]}]}.
Rules:
- Use only the page text supplied. Do not invent an amount, a company, or a decision.
- Restate a fact that is missing its project, service, bidder, or condition, and cite the heading, row, or condition from that page.
- Two bidders are alternatives. Give each fact its bidder. Do not drop either price.
- If a fact belongs to otherTopicsOnThesePages, return it with omit true.
- Leave a fact out of the reply when you cannot support a repair from the page.`;

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
  const skipped: string[] = [];

  if (withText.length > 0) {
    if (!isDeepSeekKeyConfigured()) {
      throw new FactResolutionError("DEEPSEEK_API_KEY is required to resolve facts from package pages.", 409);
    }
    await setFactStep(meetingId, "Resolving quoted facts from package pages");
    let completedBatches = 0;
    let lastFailure = "Fact resolution failed.";
    for (let index = 0; index < withText.length; index += 1) {
      const item = withText[index];
      if (!item) continue;
      const batches = chunkFactPages(expandFactPagesForPrompt(item.pages));
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        await setFactStep(
          meetingId,
          formatFactResolutionProgress({
            itemIndex: index + 1,
            itemCount: withText.length,
            batchIndex: batchIndex + 1,
            batchCount: Math.max(batches.length, 1),
            label: `${item.itemNumber} ${item.title}`,
          }),
        );
        try {
          const facts = await requestItemFacts(item, batches[batchIndex] ?? [], withText, deepSeekUsage);
          const prior = proposedByItem.get(item.id) ?? [];
          proposedByItem.set(item.id, [...prior, ...facts]);
          completedBatches += 1;
        } catch (error) {
          if (isDeepSeekSilentStall(error)) {
            await setFactStep(meetingId, "Fact resolution stopped because DeepSeek sent no text");
            throw new FactResolutionError(silentFactMessage(error), 502);
          }
          lastFailure = error instanceof Error ? error.message : lastFailure;
          skipped.push(`${item.itemNumber} ${item.title}`);
        }
      }
    }
    if (completedBatches === 0 && skipped.length > 0) {
      await setFactStep(meetingId, "Fact resolution failed");
      throw new FactResolutionError(lastFailure, 502);
    }
  }

  let orgDocuments: Awaited<ReturnType<typeof loadOrgMentionSearchDocuments>> = [];
  try {
    orgDocuments = await loadOrgMentionSearchDocuments();
  } catch {
    orgDocuments = [];
  }

  const factsByItem = new Map<string, MeetingsV3ItemFacts>();
  let factCount = 0;
  let unresolvedItemCount = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    const accepted = acceptQuotedFacts({
      pages: item.pages,
      proposed: proposedByItem.get(item.id) ?? [],
      title: item.title,
      siblingTitles: siblingTitlesFor(item, items),
    });
    if (
      withText.length > 0
      && accepted.reviewIssues.length > 0
      && accepted.reviewIssues.length <= FACT_RECOVERY_MAX_ISSUES
      && item.pages.length > 0
    ) {
      await setFactStep(
        meetingId,
        formatFactResolutionProgress({
          itemIndex: index + 1,
          itemCount: items.length,
          batchIndex: 1,
          batchCount: 1,
          label: `Checking ${item.itemNumber} ${item.title}`,
        }),
      );
    }
    let recovered: Awaited<ReturnType<typeof recoverItemFacts>>;
    try {
      recovered = await recoverItemFacts(item, items, accepted, deepSeekUsage);
    } catch (error) {
      if (!isDeepSeekSilentStall(error)) throw error;
      await setFactStep(meetingId, "Fact resolution stopped because DeepSeek sent no text");
      throw new FactResolutionError(silentFactMessage(error), 502);
    }
    const proposed = recovered
      ? mergeProposedFacts(proposedByItem.get(item.id) ?? [], recovered)
      : (proposedByItem.get(item.id) ?? []);
    const facts = applyOrganizationMatches(
      recovered
        ? acceptQuotedFacts({
            pages: item.pages,
            proposed,
            title: item.title,
            siblingTitles: siblingTitlesFor(item, items),
          })
        : accepted,
      orgDocuments,
    );
    factsByItem.set(item.id, facts);
    factCount += facts.candidates.length;
    if (facts.reviewIssues.length > 0) unresolvedItemCount += 1;
  }

  const completedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(meetingsV3AgendaItems)
        .set({
          factsJson: JSON.stringify(factsByItem.get(item.id)),
          factGroupsJson: null,
          conclusionsJson: null,
        })
        .where(eq(meetingsV3AgendaItems.id, item.id));
    }
  });
  await writeMeetingsV3FactResolution(meetingId, {
    completedAt,
    factCount,
    unresolvedItemCount,
  });
  const skippedNote = skipped.length > 0 ? ` Some pages timed out: ${[...new Set(skipped)].join(", ")}.` : "";
  await setFactStep(
    meetingId,
    `${unresolvedItemCount > 0
      ? "Quoted facts stored; some items need a look"
      : factCount > 0
        ? "Quoted facts stored from package pages"
        : "No quoted facts on the linked pages"}${skippedNote}`,
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
  items: readonly FactSourceItem[],
  deepSeekUsage: DeepSeekGenerationResult[],
): Promise<MeetingsV3ProposedFact[]> {
  if (pages.length === 0) return [];
  const pageNumbers = pages.map((page) => page.pageNumber);
  const promptChars = pages.reduce((sum, page) => sum + page.text.length, 0);
  console.info(
    `[v3-facts] ${item.itemNumber} pages ${pageNumbers.join(",")} (${promptChars} chars) model=deepseek-v4-flash thinking=off`,
  );
  try {
    const response = await generateDeepSeekJson({
      systemInstruction: FACT_RESOLUTION_PROMPT,
      userText: JSON.stringify({
        items: [
          {
            agendaItemId: item.id,
            itemNumber: item.itemNumber,
            title: item.title,
            otherTopicsOnThesePages: siblingTitlesFor(item, items),
            pages: pages.map((page) => ({
              pageNumber: page.pageNumber,
              text: page.text,
            })),
          },
        ],
      }),
      modelName: "deepseek-v4-flash",
      temperature: 0,
      thinking: false,
      maxOutputTokens: FACT_RESOLUTION_MAX_OUTPUT_TOKENS,
      requestTimeoutMs: FACT_RESOLUTION_REQUEST_TIMEOUT_MS,
      stallTimeoutMs: FACT_RESOLUTION_STALL_MS,
    });
    deepSeekUsage.push(response);
    return readProposedFacts(response.text).flatMap((entry) =>
      entry.agendaItemId === item.id ? entry.facts : [],
    );
  } catch (error) {
    if (factRequestShouldSplit(error, pages.length)) {
      const mid = Math.ceil(pages.length / 2);
      const left = await requestItemFacts(item, pages.slice(0, mid), items, deepSeekUsage);
      const right = await requestItemFacts(item, pages.slice(mid), items, deepSeekUsage);
      return [...left, ...right];
    }
    const only = pages[0];
    if (pages.length === 1 && only && factSliceShouldDivide(error, only.text.length)) {
      const mid = Math.floor(only.text.length / 2);
      const breakAt = only.text.lastIndexOf(" ", mid);
      const splitAt = breakAt > mid / 2 ? breakAt : mid;
      const left = await requestItemFacts(item, [{ ...only, text: only.text.slice(0, splitAt) }], items, deepSeekUsage);
      const right = await requestItemFacts(item, [{ ...only, text: only.text.slice(splitAt).trimStart() }], items, deepSeekUsage);
      return [...left, ...right];
    }
    throw error;
  }
}

async function recoverItemFacts(
  item: FactSourceItem,
  items: readonly FactSourceItem[],
  accepted: MeetingsV3ItemFacts,
  deepSeekUsage: DeepSeekGenerationResult[],
): Promise<MeetingsV3ProposedFact[] | null> {
  if (accepted.reviewIssues.length === 0 || accepted.reviewIssues.length > FACT_RECOVERY_MAX_ISSUES) return null;
  if (item.pages.length === 0) return null;
  if (!isDeepSeekKeyConfigured()) return null;
  try {
    const response = await generateDeepSeekJson({
      systemInstruction: FACT_RECOVERY_PROMPT,
      userText: JSON.stringify({
        items: [
          {
            agendaItemId: item.id,
            itemNumber: item.itemNumber,
            title: item.title,
            otherTopicsOnThesePages: siblingTitlesFor(item, items),
            issues: accepted.reviewIssues,
            facts: accepted.candidates,
            pages: item.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
          },
        ],
      }),
      modelName: "deepseek-v4-flash",
      temperature: 0,
      thinking: false,
      maxOutputTokens: FACT_RESOLUTION_MAX_OUTPUT_TOKENS,
      requestTimeoutMs: FACT_RESOLUTION_REQUEST_TIMEOUT_MS,
      stallTimeoutMs: FACT_RESOLUTION_STALL_MS,
    });
    deepSeekUsage.push(response);
    return readProposedFacts(response.text).flatMap((entry) =>
      entry.agendaItemId === item.id ? entry.facts : [],
    );
  } catch (error) {
    if (isDeepSeekSilentStall(error)) throw error;
    return null;
  }
}

/** A fact call that DeepSeek accepted and then left empty. Splitting the page will not help. */
function isDeepSeekSilentStall(error: unknown): boolean {
  return error instanceof Error && error.message.includes("sent no text");
}

/** The stall detail for the meeting screen, with a fallback when the client message is short. */
function silentFactMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (detail.includes("accepted the request in")) return detail;
  return "DeepSeek accepted the request and sent no text, so this run stopped instead of waiting on an empty reply.";
}

function siblingTitlesFor(item: FactSourceItem, items: readonly FactSourceItem[]): string[] {
  const pages = new Set(item.pages.map((page) => page.pageNumber));
  return items
    .filter((other) => other.id !== item.id && other.pages.some((page) => pages.has(page.pageNumber)))
    .map((other) => `${other.itemNumber} ${other.title}`);
}

async function setFactStep(meetingId: string, currentStep: string): Promise<void> {
  const db = getDb();
  await db
    .update(meetingsV2)
    .set({ currentStep, updatedAt: new Date().toISOString() })
    .where(eq(meetingsV2.id, meetingId));
}
