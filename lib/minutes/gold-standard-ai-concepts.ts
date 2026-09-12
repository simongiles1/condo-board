import { parseDraftMinutesDoc } from "@/lib/minutes/doc-v2-edits";
import { pairMatchScore } from "@/lib/minutes/gold-standard-item-match";
import type {
  AiMinutesConcept,
  GoldStandardConceptKind,
} from "@/lib/minutes/gold-standard-schema";
import { validateMinutesJson, type MinutesDocument, type Section } from "@/lib/minutes/schema";
import {
  validateMinutesV2,
  type AgendaItemV2,
  type MinutesDocumentV2,
} from "@/lib/minutes/schema-v2";
import {
  formatAttendeeLine,
  inlineAgendaItemSuffixMarkdown,
  renderMotionLines,
} from "@/lib/minutes/v2-render-helpers";

export type AgendaItemRef = {
  id: string;
  title: string;
  itemNumber?: string | null;
  sectionLabel?: string | null;
};

const AGENDA_MATCH_THRESHOLD = 28;

function pushConcept(
  concepts: AiMinutesConcept[],
  options: {
    id: string;
    heading: string;
    body: string;
    kind: GoldStandardConceptKind;
    sectionLabel?: string;
  },
) {
  const heading = options.heading.trim();
  const body = options.body.trim();
  if (!heading && !body) return;
  concepts.push({
    id: options.id,
    heading: heading || options.kind,
    body: body || heading,
    kind: options.kind,
    sortOrder: concepts.length,
    ...(options.sectionLabel ? { sectionLabel: options.sectionLabel } : {}),
    agendaItemIds: [],
  });
}

function formatAgendaItemBody(item: AgendaItemV2): string {
  const parts: string[] = [];
  if (item.summary.trim()) parts.push(item.summary.trim());
  if (item.motion) {
    parts.push(renderMotionLines(item.motion).lines.join("\n"));
  }
  const suffix = inlineAgendaItemSuffixMarkdown(item).trim();
  if (suffix) parts.push(suffix);
  return parts.join("\n\n");
}

function walkAgendaItems(
  items: AgendaItemV2[] | undefined,
  sectionLabel: string,
  kind: GoldStandardConceptKind,
  parentId: string,
  concepts: AiMinutesConcept[],
) {
  if (!items?.length) return;
  items.forEach((item, index) => {
    const id = `${parentId}.${index}`;
    const body = formatAgendaItemBody(item);
    const topic = item.topic.trim();
    const hasOwnRecord = Boolean(body);
    if (topic && (hasOwnRecord || item.subItems.length === 0)) {
      pushConcept(concepts, {
        id,
        heading: topic,
        body: body || topic,
        kind,
        sectionLabel,
      });
    }
    walkAgendaItems(item.subItems, sectionLabel, kind, id, concepts);
  });
}

function flattenMinutesV2(doc: MinutesDocumentV2): AiMinutesConcept[] {
  const concepts: AiMinutesConcept[] = [];
  const attendance = doc.attendance;
  const attendanceLines: string[] = [];
  if (attendance?.present.length) {
    attendanceLines.push(
      `Present: ${attendance.present.map(formatAttendeeLine).join("; ")}`,
    );
  }
  if (attendance?.byInvitation.length) {
    attendanceLines.push(
      `By invitation: ${attendance.byInvitation.map(formatAttendeeLine).join("; ")}`,
    );
  }
  if (attendance?.guests.length) {
    attendanceLines.push(
      `Guests: ${attendance.guests.map(formatAttendeeLine).join("; ")}`,
    );
  }
  if (attendance?.regrets.length) {
    attendanceLines.push(
      `Regrets: ${attendance.regrets.map(formatAttendeeLine).join("; ")}`,
    );
  }
  pushConcept(concepts, {
    id: "ai:attendance",
    heading: "Attendance",
    body: attendanceLines.join("\n"),
    kind: "attendance",
    sectionLabel: "Attendance",
  });

  if (doc.callToOrder) {
    const parts = [
      doc.callToOrder.chairName ? `Chair: ${doc.callToOrder.chairName}` : "",
      doc.callToOrder.time ? `Time: ${doc.callToOrder.time}` : "",
    ].filter(Boolean);
    pushConcept(concepts, {
      id: "ai:call-to-order",
      heading: "Call to Order",
      body: parts.join("\n"),
      kind: "call_to_order",
      sectionLabel: "Call to Order",
    });
  }

  (doc.approvalOfPreviousMinutes ?? []).forEach((entry, index) => {
    const parts = [
      entry.previousMeetingDate
        ? `Previous meeting: ${entry.previousMeetingDate}`
        : "",
      entry.amendmentsNoted ? "Amendments were noted." : "",
      entry.motion ? renderMotionLines(entry.motion).lines.join("\n") : "",
    ].filter(Boolean);
    pushConcept(concepts, {
      id: `ai:previous-minutes.${index}`,
      heading: "Approval of Previous Minutes",
      body: parts.join("\n\n"),
      kind: "previous_minutes",
      sectionLabel: "Approval of Previous Minutes",
    });
  });

  walkAgendaItems(
    doc.specialPresentations,
    "Special Presentations",
    "agenda_item",
    "ai:special",
    concepts,
  );
  walkAgendaItems(
    doc.financialMatters,
    "Financial Matters",
    "financial",
    "ai:financial",
    concepts,
  );

  const mgmt = doc.managementReport;
  if (mgmt) {
    walkAgendaItems(
      mgmt.itemsForRatification,
      "Items for Ratification",
      "agenda_item",
      "ai:ratification",
      concepts,
    );
    walkAgendaItems(
      mgmt.itemsForApproval,
      "Items for Approval",
      "agenda_item",
      "ai:approval",
      concepts,
    );
    walkAgendaItems(
      mgmt.itemsForInformation,
      "Items for Information",
      "agenda_item",
      "ai:information",
      concepts,
    );
    walkAgendaItems(
      mgmt.itemsForDiscussion,
      "Items for Discussion",
      "agenda_item",
      "ai:discussion",
      concepts,
    );
  }

  walkAgendaItems(
    doc.correspondence,
    "Correspondence",
    "agenda_item",
    "ai:correspondence",
    concepts,
  );
  walkAgendaItems(
    doc.newOrOtherBusiness,
    "New or Other Business",
    "agenda_item",
    "ai:other-business",
    concepts,
  );

  if (doc.dateOfNextMeeting) {
    const parts = [
      doc.dateOfNextMeeting.date ? `Date: ${doc.dateOfNextMeeting.date}` : "",
      doc.dateOfNextMeeting.time ? `Time: ${doc.dateOfNextMeeting.time}` : "",
      doc.dateOfNextMeeting.location
        ? `Location: ${doc.dateOfNextMeeting.location}`
        : "",
    ].filter(Boolean);
    pushConcept(concepts, {
      id: "ai:next-meeting",
      heading: "Date of Next Meeting",
      body: parts.join("\n"),
      kind: "next_meeting",
      sectionLabel: "Date of Next Meeting",
    });
  }

  if (doc.termination?.time) {
    pushConcept(concepts, {
      id: "ai:termination",
      heading: "Termination",
      body: `Time: ${doc.termination.time}`,
      kind: "termination",
      sectionLabel: "Termination",
    });
  }

  (doc.postTerminationSections ?? []).forEach((section, sectionIndex) => {
    walkAgendaItems(
      section.items,
      section.title,
      "agenda_item",
      `ai:post.${sectionIndex}`,
      concepts,
    );
  });

  return concepts;
}

function flattenV1Section(
  section: Section,
  parentId: string,
  concepts: AiMinutesConcept[],
) {
  const heading = [section.number, section.title].filter(Boolean).join(" ").trim();
  const bodyParts: string[] = [];
  if (section.lead?.trim()) bodyParts.push(section.lead.trim());
  for (const block of section.blocks ?? []) {
    if (block.kind === "paragraph" || block.kind === "note" || block.kind === "action") {
      bodyParts.push(block.text);
    } else if (block.kind === "motion") {
      bodyParts.push(
        [
          `MOTION by ${block.mover}`,
          `Seconded by ${block.seconder}`,
          `THAT ${block.resolution}`,
          block.outcome,
        ].join("\n"),
      );
    } else if (block.kind === "list") {
      for (const item of block.items) {
        const title = item.title?.trim();
        const nested = item.blocks
          .map((nestedBlock) =>
            "text" in nestedBlock ? nestedBlock.text : "",
          )
          .filter(Boolean)
          .join(" ");
        bodyParts.push([item.marker, title, nested].filter(Boolean).join(" "));
      }
    }
  }
  pushConcept(concepts, {
    id: parentId,
    heading: heading || parentId,
    body: bodyParts.join("\n\n"),
    kind: "agenda_item",
    sectionLabel: section.title,
  });
  (section.subsections ?? []).forEach((sub, index) => {
    flattenV1Section(sub, `${parentId}.${index}`, concepts);
  });
}

function flattenMinutesV1(doc: MinutesDocument): AiMinutesConcept[] {
  const concepts: AiMinutesConcept[] = [];
  const attendanceLines: string[] = [];
  if (doc.present.length) {
    attendanceLines.push(
      `Present: ${doc.present.map((row) => `${row.name} - ${row.role}`).join("; ")}`,
    );
  }
  if (doc.byInvitation.length) {
    attendanceLines.push(
      `By invitation: ${doc.byInvitation.map((row) => `${row.name} - ${row.role}`).join("; ")}`,
    );
  }
  if (doc.regrets.length) {
    attendanceLines.push(
      `Regrets: ${doc.regrets.map((row) => `${row.name} - ${row.role}`).join("; ")}`,
    );
  }
  pushConcept(concepts, {
    id: "ai:attendance",
    heading: "Attendance",
    body: attendanceLines.join("\n"),
    kind: "attendance",
  });
  doc.sections.forEach((section, index) => {
    flattenV1Section(section, `ai:section.${index}`, concepts);
  });
  return concepts;
}

export function attachAgendaItemIds(
  concepts: AiMinutesConcept[],
  agendaItems: AgendaItemRef[],
): AiMinutesConcept[] {
  if (agendaItems.length === 0) return concepts;
  return concepts.map((concept) => {
    let bestId: string | null = null;
    let bestScore = 0;
    for (const item of agendaItems) {
      const score = Math.max(
        pairMatchScore(concept.heading, item.title),
        item.itemNumber
          ? pairMatchScore(concept.heading, item.itemNumber)
          : 0,
        item.sectionLabel
          ? pairMatchScore(concept.sectionLabel ?? "", item.sectionLabel) * 0.4
          : 0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestId = item.id;
      }
    }
    return {
      ...concept,
      agendaItemIds:
        bestId && bestScore >= AGENDA_MATCH_THRESHOLD ? [bestId] : [],
    };
  });
}

export function buildAiMinutesConcepts(
  minutesJson: string,
  agendaItems: AgendaItemRef[] = [],
): AiMinutesConcept[] {
  const fromDraft = parseDraftMinutesDoc(minutesJson);
  if (fromDraft) {
    return attachAgendaItemIds(flattenMinutesV2(fromDraft), agendaItems);
  }

  try {
    const parsed = JSON.parse(minutesJson) as unknown;
    const v2 = validateMinutesV2(
      parsed && typeof parsed === "object" && "data" in (parsed as object)
        ? (parsed as { data: unknown }).data
        : parsed,
    );
    if (v2.value) {
      return attachAgendaItemIds(flattenMinutesV2(v2.value), agendaItems);
    }
    const v1 = validateMinutesJson(parsed);
    if (v1.value) {
      return attachAgendaItemIds(flattenMinutesV1(v1.value), agendaItems);
    }
  } catch {
    /* fall through */
  }

  const trimmed = minutesJson.trim();
  if (!trimmed) return [];
  return attachAgendaItemIds(
    [
      {
        id: "ai:document",
        heading: "AI-generated minutes",
        body: trimmed.slice(0, 20_000),
        kind: "other",
        sortOrder: 0,
        agendaItemIds: [],
      },
    ],
    agendaItems,
  );
}
