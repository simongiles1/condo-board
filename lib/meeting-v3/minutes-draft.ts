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
};

/** A minutes document plus the markdown a reviewer reads. */
export type MeetingsV3DraftAssembly = {
  document: MinutesDocumentV2;
  markdown: string;
  warnings: string[];
};

const DISCUSSION_LIMIT = 700;

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
  const label = openPointCount === 1 ? "point stays" : "points stay";
  return `> Working draft. ${openPointCount} open ${label} in the topic summaries. These minutes are incomplete until each open decision or figure is supported.\n\n${body}`;
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
  const parts: string[] = [];
  const conclusion = item.conclusion;
  if (!conclusion || conclusion.status === "unclear") {
    parts.push("This topic has no settled decision in the assigned transcript.");
  } else {
    const talk = conclusion.quote?.trim() || truncate(conclusion.discussion);
    if (talk) parts.push(talk);
    if (conclusion.packageQuote && !conclusion.openReference) {
      parts.push(`The discussion pointed at: ${conclusion.packageQuote}`);
    }
  }
  if (conclusion?.openReference) {
    parts.push("Open: the discussion points at a package fact this topic does not have.");
  }
  for (const issue of item.reviewIssues) {
    parts.push(`Open: ${issue.message}`);
  }
  const summary = parts.join(" ").replace(/\s+/g, " ").trim();
  return summary || item.title.trim() || "No discussion was recorded.";
}

function truncate(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= DISCUSSION_LIMIT) return text;
  return `${text.slice(0, DISCUSSION_LIMIT - 3).trimEnd()}...`;
}
