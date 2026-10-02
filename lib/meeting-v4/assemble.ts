/**
 * Assembles V4 item drafts into the V2 minutes document.
 * Procedural items stay in the body so their paragraphs can be read.
 * Dedicated attendance and closing fields stay empty.
 */

import { parentAgendaItemCode } from "@/lib/meeting-v2/agenda-outline";
import { mapSuggestedSectionPath } from "@/lib/meeting-v2/draft-builder";
import { v2ToMarkdown } from "@/lib/minutes/v2-to-markdown";
import {
  validateMinutesV2,
  type AgendaItemV2,
  type ApprovalOfPreviousMinutesV2,
  type MinutesDocumentV2,
  type MotionV2,
} from "@/lib/minutes/schema-v2";
import type { MeetingsV4ItemResult, MeetingsV4MotionNote, MeetingsV4MotionOutcome } from "@/lib/meeting-v4/types";
import { CORP_LONG } from "@/lib/pdf/corporation";

/** One drafted row plus the agenda placement fields. */
export type MeetingsV4AssemblyItem = MeetingsV4ItemResult & {
  itemType: string;
  sectionLabel: string;
};

/** A minutes document and the markdown a reviewer reads. */
export type MeetingsV4Assembly = {
  document: MinutesDocumentV2;
  markdown: string;
};

const BODY_PATHS = new Set(["call_to_order", "date_of_next_meeting", "termination"]);

/**
 * Places each drafted paragraph into the V2 minutes sections.
 * Throws when the document fails the V2 minutes schema.
 * A decision made at this meeting becomes the formal motion block.
 */
export function assembleMeetingsV4Minutes(input: {
  title: string;
  meetingDate: string;
  items: readonly MeetingsV4AssemblyItem[];
}): MeetingsV4Assembly {
  if (!input.title.trim()) {
    throw new Error("A meeting title is required before assembling minutes.");
  }
  const document = buildDocument(input);
  const validated = validateMinutesV2(document);
  if (!validated.value || validated.errors.length > 0) {
    throw new Error(validated.errors.join(" ") || "The minutes draft failed validation.");
  }
  return { document: validated.value, markdown: v2ToMarkdown(validated.value) };
}

function buildDocument(input: {
  title: string;
  meetingDate: string;
  items: readonly MeetingsV4AssemblyItem[];
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
  const isHeading = (item: MeetingsV4AssemblyItem) =>
    !hasDuplicateNumbers
    && item.itemNumber.split(".").length < 3
    && input.items.some((other) => other.itemNumber.startsWith(`${item.itemNumber}.`) && other.agendaItemId !== item.agendaItemId);
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
    const visiblePath = BODY_PATHS.has(sectionPath) ? "new_or_other_business" : sectionPath;
    switch (visiblePath) {
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
          sourceAgendaItemId: item.agendaItemId,
          summary: agendaItem.summary,
          motion: agendaItem.motion,
        });
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

function toAgendaItem(item: MeetingsV4AssemblyItem): AgendaItemV2 {
  const written = item.minutes?.replace(/\s+/g, " ").trim();
  return {
    sourceAgendaItemId: item.agendaItemId,
    sourceItemNumber: item.itemNumber,
    topic: item.title.trim() || "Untitled",
    summary: written || (
      item.evidenceFit === "transcript_missing"
        ? "No reviewed transcript span was assigned to this item."
        : "A paragraph was not returned for this item."
    ),
    actionItems: item.actions.map((action) => ({
      assignee: action.owner?.trim() || "Unassigned",
      taskDescription: action.description,
    })),
    motion: motionForMinutes(item.motion),
    subItems: [],
    restricted: item.restricted || undefined,
  };
}

const MOTION_STATUS: Record<MeetingsV4MotionOutcome, MotionV2["status"]> = {
  carried: "Motion carried.",
  defeated: "Motion defeated.",
  deferred: "Deferred.",
  unrecorded: "Outcome not recorded.",
};

/**
 * The motion block for one item.
 * A stored draft from before resolutions has names only, and those stay off the page.
 */
function motionForMinutes(motion: MeetingsV4MotionNote): MotionV2 | undefined {
  const resolutionText = typeof motion.resolution === "string" ? motion.resolution.trim() : "";
  if (!resolutionText) return undefined;
  return {
    movedBy: motion.mover?.trim() ?? "",
    secondedBy: motion.seconder?.trim() ?? "",
    resolutionText,
    status: MOTION_STATUS[motion.outcome] ?? "Outcome not recorded.",
  };
}
