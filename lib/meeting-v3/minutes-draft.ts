/**
 * Builds a V2 minutes document from reconciled V3 topics.
 * Section placement follows the V2 agenda map. An unsupported conclusion is not printed as settled.
 */

import { parentAgendaItemCode } from "@/lib/meeting-v2/agenda-outline";
import { mapSuggestedSectionPath } from "@/lib/meeting-v2/draft-builder";
import { v2ToMarkdown } from "@/lib/minutes/v2-to-markdown";
import {
  validateMinutesV2,
  type AgendaItemStatus,
  type AgendaItemV2,
  type ApprovalOfPreviousMinutesV2,
  type MinutesDocumentV2,
} from "@/lib/minutes/schema-v2";
import { CORP_LONG } from "@/lib/pdf/corporation";
import type { MeetingsV3FactReview } from "@/lib/meeting-v3/facts";
import type { MeetingsV3ItemConclusion } from "@/lib/meeting-v3/meeting-conclusions";

/** One V3 agenda row the draft can place into minutes. */
export type MeetingsV3DraftSourceItem = {
  id: string;
  itemNumber: string;
  title: string;
  sectionLabel: string;
  itemType: string;
  conclusion: MeetingsV3ItemConclusion | null;
  reviewIssues: readonly MeetingsV3FactReview[];
  /** Formal minutes paragraph. When missing, the draft uses a short status sentence. */
  minutesSummary?: string | null;
};

/** A minutes document plus the markdown a reviewer reads. */
export type MeetingsV3DraftAssembly = {
  document: MinutesDocumentV2;
  markdown: string;
  warnings: string[];
};

const STRUCTURAL_PATHS = new Set(["call_to_order", "date_of_next_meeting", "termination"]);

/**
 * Instructions for the minutes paragraph written for one topic.
 * The outcome is already fixed. The paragraph must not reprint speech or unverified figures.
 */
export const MEETINGS_V3_MINUTES_PROSE_PROMPT = `You write one paragraph of condominium board minutes.

The outcome is already decided. Do not change it.
Write two to four sentences in formal third person, for a reader who was not in the room.
Say what the board considered and what happened next.
Do not quote speech. Do not include filler such as "uh" or "um".
Do not print a withheld figure, and do not write the word "Open".
Do not invent a mover, a seconder, a vote count, or a dollar amount.
When the outcome is discussed or unclear, say that no decision was recorded. Do not say the board approved the item.

Return JSON only: { "summary": "string" }`;

/**
 * Topics that appear in the minutes body and need a written paragraph.
 * Headings and call-to-order, next-meeting, and adjournment rows are left out.
 */
export function meetingsV3ItemsNeedingMinutesProse(
  items: readonly MeetingsV3DraftSourceItem[],
): MeetingsV3DraftSourceItem[] {
  return items.filter((item) => itemAppearsInMinutes(item, items));
}

/**
 * Reads a minutes paragraph from a model reply.
 * Returns null when the reply is empty, still sounds like speech, or dumps open points.
 */
export function readMeetingsV3MinutesProse(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let summary = trimmed;
  const fenced = trimmed.match(/\{[\s\S]*\}/);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[0]) as { summary?: unknown };
      if (typeof parsed.summary === "string" && parsed.summary.trim()) summary = parsed.summary.trim();
    } catch {
      return null;
    }
  }
  summary = summary.replace(/\s+/g, " ").trim();
  if (summary.length < 24) return null;
  if (/\b(uh|um)\b/i.test(summary)) return null;
  if (/\bopen\s*:/i.test(summary)) return null;
  return summary;
}

/**
 * Assembles minutes from reconciled topics and renders them.
 * Throws when the document fails the V2 minutes schema.
 */
export function assembleMeetingsV3Minutes(input: {
  title: string;
  meetingDate: string;
  items: readonly MeetingsV3DraftSourceItem[];
  openPointCount: number;
}): MeetingsV3DraftAssembly {
  if (!input.title.trim()) {
    throw new Error("A meeting title is required before drafting minutes.");
  }
  const document = buildMinutesDocument(input);
  const validated = validateMinutesV2(document);
  if (!validated.value || validated.errors.length > 0) {
    throw new Error(validated.errors.join(" ") || "The minutes draft failed validation.");
  }
  return {
    document: validated.value,
    markdown: meetingsV3DraftMarkdown(validated.value, input.openPointCount),
    warnings: validated.warnings,
  };
}

/**
 * Markdown for a V3 draft, with a banner while open points remain.
 */
export function meetingsV3DraftMarkdown(document: MinutesDocumentV2, openPointCount: number): string {
  const body = v2ToMarkdown(document);
  if (openPointCount <= 0) return body;
  const label = openPointCount === 1 ? "point is listed" : "points are listed";
  return `> Working draft. ${openPointCount} open ${label} on Check minutes. These minutes are incomplete until each open decision or figure is supported.\n\n${body}`;
}

function buildMinutesDocument(input: {
  title: string;
  meetingDate: string;
  items: readonly MeetingsV3DraftSourceItem[];
}): MinutesDocumentV2 {
  const sections = {
    specialPresentations: [] as AgendaItemV2[],
    financialMatters: [] as AgendaItemV2[],
    managementRatification: [] as AgendaItemV2[],
    managementApproval: [] as AgendaItemV2[],
    managementInformation: [] as AgendaItemV2[],
    managementDiscussion: [] as AgendaItemV2[],
    correspondence: [] as AgendaItemV2[],
    newOrOtherBusiness: [] as AgendaItemV2[],
  };
  const approvals: ApprovalOfPreviousMinutesV2[] = [];
  const numbers = input.items.map((item) => item.itemNumber);
  const hasDuplicateNumbers = new Set(numbers).size !== numbers.length;
  const isHeading = (item: MeetingsV3DraftSourceItem) =>
    !hasDuplicateNumbers
    && item.itemNumber.split(".").length < 3
    && input.items.some((other) => other.itemNumber.startsWith(`${item.itemNumber}.`) && other.id !== item.id);
  const built = new Map<string, AgendaItemV2>();

  for (const item of input.items) {
    const agendaItem = toAgendaItem(item);
    const parentNumber = hasDuplicateNumbers ? null : parentAgendaItemCode(item.itemNumber);
    const parent = parentNumber ? built.get(parentNumber) : undefined;
    if (parent) parent.subItems.push(agendaItem);
    if (!isHeading(item)) built.set(item.itemNumber, agendaItem);
    if (isHeading(item) || parent) continue;

    const sectionPath = mapSuggestedSectionPath({
      itemType: item.itemType,
      sectionLabel: item.sectionLabel,
    });
    switch (sectionPath) {
      case "special_presentations":
        sections.specialPresentations.push(agendaItem);
        break;
      case "financial_matters":
        sections.financialMatters.push(agendaItem);
        break;
      case "management_report.items_for_ratification":
        sections.managementRatification.push(agendaItem);
        break;
      case "management_report.items_for_approval":
        sections.managementApproval.push(agendaItem);
        break;
      case "management_report.items_for_information":
        sections.managementInformation.push(agendaItem);
        break;
      case "management_report.items_for_discussion":
        sections.managementDiscussion.push(agendaItem);
        break;
      case "correspondence":
        sections.correspondence.push(agendaItem);
        break;
      case "approval_of_previous_minutes":
        approvals.push({
          sourceAgendaItemId: item.id,
          summary: agendaItem.summary,
          motion: agendaItem.motion,
        });
        break;
      case "new_or_other_business":
        sections.newOrOtherBusiness.push(agendaItem);
        break;
      case "date_of_next_meeting":
      case "termination":
      case "call_to_order":
        break;
      default:
        sections.newOrOtherBusiness.push(agendaItem);
        break;
    }
  }

  return {
    metadata: {
      corporationName: CORP_LONG,
      meetingDate: input.meetingDate,
      meetingTime: "",
    },
    attendance: { present: [], byInvitation: [], guests: [], regrets: [] },
    specialPresentations: sections.specialPresentations,
    approvalOfPreviousMinutes: approvals,
    financialMatters: sections.financialMatters,
    managementReport: {
      itemsForRatification: sections.managementRatification,
      itemsForApproval: sections.managementApproval,
      itemsForInformation: sections.managementInformation,
      itemsForDiscussion: sections.managementDiscussion,
    },
    correspondence: sections.correspondence,
    newOrOtherBusiness: sections.newOrOtherBusiness,
    postTerminationSections: [],
  };
}

function toAgendaItem(item: MeetingsV3DraftSourceItem): AgendaItemV2 {
  const unsupported = !item.conclusion || item.conclusion.status === "unclear" || item.conclusion.openReference === true;
  return {
    sourceAgendaItemId: item.id,
    sourceItemNumber: item.itemNumber,
    topic: item.title.trim() || "Untitled",
    summary: summaryFor(item),
    actionItems: [],
    subItems: [],
    status: unsupported ? "Outcome not recorded." : statusFor(item.conclusion!.status),
  };
}

function statusFor(status: MeetingsV3ItemConclusion["status"]): AgendaItemStatus {
  if (status === "ratified") return "Motion carried.";
  if (status === "deferred") return "Deferred.";
  if (status === "discussed") return "Information only.";
  return "Outcome not recorded.";
}

function summaryFor(item: MeetingsV3DraftSourceItem): string {
  const written = item.minutesSummary?.replace(/\s+/g, " ").trim();
  if (written) return written;
  const title = item.title.trim() || "this topic";
  const status = item.conclusion?.status;
  if (status === "ratified" && item.conclusion?.openReference !== true) return `The Board approved ${title}.`;
  if (status === "deferred") return `The Board deferred ${title}.`;
  if (status === "discussed") return `The Board discussed ${title}. No decision was recorded.`;
  return `The assigned transcript does not record a decision on ${title}.`;
}

function itemAppearsInMinutes(
  item: MeetingsV3DraftSourceItem,
  items: readonly MeetingsV3DraftSourceItem[],
): boolean {
  if (isHeading(item, items)) return false;
  const sectionPath = mapSuggestedSectionPath({
    itemType: item.itemType,
    sectionLabel: item.sectionLabel,
  });
  return !STRUCTURAL_PATHS.has(sectionPath);
}

function isHeading(
  item: MeetingsV3DraftSourceItem,
  items: readonly MeetingsV3DraftSourceItem[],
): boolean {
  const numbers = items.map((entry) => entry.itemNumber);
  if (new Set(numbers).size !== numbers.length) return false;
  return item.itemNumber.split(".").length < 3
    && items.some((other) => other.itemNumber.startsWith(`${item.itemNumber}.`) && other.id !== item.id);
}
