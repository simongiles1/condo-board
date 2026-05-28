import type {
  MinutesSectionPath,
  OmissionFinding,
} from "@/lib/minutes/omissions-schema";
import type { AgendaItemV2, MinutesDocumentV2 } from "@/lib/minutes/schema-v2";
import { consolidateActionItemsByAssignee } from "@/lib/minutes/consolidate-action-items";
import {
  parseMinutesJsonEnvelope,
  sanitizeMinutesDocumentV2,
  wrapMinutesV2,
} from "@/lib/minutes/schema-v2";

type SectionRef = {
  items: AgendaItemV2[];
  apply: (items: AgendaItemV2[]) => MinutesDocumentV2;
};

function getSectionRef(
  doc: MinutesDocumentV2,
  targetSection: MinutesSectionPath,
  postTerminationTitle?: string,
): SectionRef | null {
  switch (targetSection) {
    case "special_presentations":
      return {
        items: doc.specialPresentations,
        apply: (items) => ({ ...doc, specialPresentations: items }),
      };
    case "financial_matters":
      return {
        items: doc.financialMatters,
        apply: (items) => ({ ...doc, financialMatters: items }),
      };
    case "correspondence":
      return {
        items: doc.correspondence,
        apply: (items) => ({ ...doc, correspondence: items }),
      };
    case "new_or_other_business":
      return {
        items: doc.newOrOtherBusiness,
        apply: (items) => ({ ...doc, newOrOtherBusiness: items }),
      };
    case "management_report.items_for_ratification":
      return {
        items: doc.managementReport.itemsForRatification,
        apply: (items) => ({
          ...doc,
          managementReport: {
            ...doc.managementReport,
            itemsForRatification: items,
          },
        }),
      };
    case "management_report.items_for_approval":
      return {
        items: doc.managementReport.itemsForApproval,
        apply: (items) => ({
          ...doc,
          managementReport: {
            ...doc.managementReport,
            itemsForApproval: items,
          },
        }),
      };
    case "management_report.items_for_information":
      return {
        items: doc.managementReport.itemsForInformation,
        apply: (items) => ({
          ...doc,
          managementReport: {
            ...doc.managementReport,
            itemsForInformation: items,
          },
        }),
      };
    case "management_report.items_for_discussion":
      return {
        items: doc.managementReport.itemsForDiscussion,
        apply: (items) => ({
          ...doc,
          managementReport: {
            ...doc.managementReport,
            itemsForDiscussion: items,
          },
        }),
      };
    case "post_termination_sections": {
      const title = postTerminationTitle?.trim() || "Other business";
      const sectionIdx = doc.postTerminationSections.findIndex(
        (s) => s.title.trim().toLowerCase() === title.toLowerCase(),
      );
      if (sectionIdx < 0) return null;
      const section = doc.postTerminationSections[sectionIdx];
      return {
        items: section.items,
        apply: (items) => {
          const sections = [...doc.postTerminationSections];
          sections[sectionIdx] = { ...section, items };
          return { ...doc, postTerminationSections: sections };
        },
      };
    }
    default:
      return null;
  }
}

function pushToSection(
  doc: MinutesDocumentV2,
  omission: OmissionFinding,
): MinutesDocumentV2 {
  const ref = getSectionRef(
    doc,
    omission.targetSection,
    omission.postTerminationTitle,
  );
  if (!ref) {
    if (omission.targetSection === "post_termination_sections") {
      const title =
        omission.postTerminationTitle?.trim() || "Other business";
      return {
        ...doc,
        postTerminationSections: [
          ...doc.postTerminationSections,
          { title, items: [{ ...omission.agendaItem }] },
        ],
      };
    }
    return doc;
  }

  return ref.apply([
    ...ref.items,
    {
      ...omission.agendaItem,
      actionItems: consolidateActionItemsByAssignee(
        omission.agendaItem.actionItems,
      ),
    },
  ]);
}

function mergeAgendaItems(
  existing: AgendaItemV2,
  incoming: AgendaItemV2,
): AgendaItemV2 {
  const actionItems = consolidateActionItemsByAssignee([
    ...existing.actionItems,
    ...incoming.actionItems,
  ]);

  return {
    ...existing,
    ...incoming,
    topic: existing.topic.trim() || incoming.topic,
    summary: incoming.summary.trim() || existing.summary,
    actionItems,
    motion: incoming.motion ?? existing.motion,
    subItems: incoming.subItems.length ? incoming.subItems : existing.subItems,
    costMentioned: incoming.costMentioned ?? existing.costMentioned,
    contractorMentioned:
      incoming.contractorMentioned ?? existing.contractorMentioned,
    status: incoming.status ?? existing.status,
    restricted: incoming.restricted ?? existing.restricted,
  };
}

function augmentAtIndex(
  doc: MinutesDocumentV2,
  omission: OmissionFinding,
): MinutesDocumentV2 {
  const index = omission.existingItemIndex;
  if (index === undefined) return doc;

  const ref = getSectionRef(
    doc,
    omission.targetSection,
    omission.postTerminationTitle,
  );
  if (!ref || index < 0 || index >= ref.items.length) {
    return pushToSection(doc, { ...omission, mergeAction: "insert_new" });
  }

  const items = [...ref.items];
  items[index] = mergeAgendaItems(items[index], omission.agendaItem);
  return ref.apply(items);
}

function applyOmission(
  doc: MinutesDocumentV2,
  omission: OmissionFinding,
): MinutesDocumentV2 {
  if (omission.mergeAction === "augment_existing") {
    return augmentAtIndex(doc, omission);
  }
  return pushToSection(doc, omission);
}

/** Merge selected omission findings into stored minutes JSON. */
export function applyOmissionsToMinutesJson(
  minutesJson: string,
  omissions: OmissionFinding[],
): string | null {
  if (!omissions.length) return null;

  const envelope = parseMinutesJsonEnvelope(minutesJson);
  if (envelope.version !== "v2" || !envelope.v2) return null;

  let doc = envelope.v2;
  for (const omission of omissions) {
    doc = applyOmission(doc, omission);
  }

  doc = sanitizeMinutesDocumentV2(doc);
  return JSON.stringify(wrapMinutesV2(doc));
}
