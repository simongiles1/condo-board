import type {
  ActionItemV2,
  AgendaItemV2,
  ApprovalOfPreviousMinutesV2,
  CallToOrderV2,
  DateOfNextMeetingV2,
  MinutesDocumentV2,
  MotionV2,
} from "@/lib/minutes/schema-v2";
import { wrapMinutesV2 } from "@/lib/minutes/schema-v2";

export type AgendaBucket =
  | "financialMatters"
  | "newOrOtherBusiness"
  | "specialPresentations"
  | "correspondence"
  | "managementReport.itemsForRatification"
  | "managementReport.itemsForApproval"
  | "managementReport.itemsForInformation"
  | "managementReport.itemsForDiscussion";

export type AgendaPath =
  | { bucket: AgendaBucket; index: number; subPath?: number[] }
  | {
      bucket: "postTerminationSections";
      sectionIndex: number;
      itemIndex: number;
      subPath?: number[];
    };

export function emptyAgendaItem(): AgendaItemV2 {
  return {
    topic: "",
    summary: "",
    actionItems: [],
    subItems: [],
  };
}

export function emptyMotion(): MotionV2 {
  return {
    movedBy: "",
    secondedBy: "",
    resolutionText: "",
    status: "Motion carried.",
  };
}

export function emptyActionItem(): ActionItemV2 {
  return { assignee: "", taskDescription: "" };
}

export function serializeMinutesDoc(doc: MinutesDocumentV2): string {
  return JSON.stringify(wrapMinutesV2(doc));
}

function cloneDoc(doc: MinutesDocumentV2): MinutesDocumentV2 {
  return structuredClone(doc);
}

function getItemsList(
  doc: MinutesDocumentV2,
  path: AgendaPath,
): AgendaItemV2[] | null {
  if (path.bucket === "postTerminationSections") {
    const section = doc.postTerminationSections[path.sectionIndex];
    return section?.items ?? null;
  }

  switch (path.bucket) {
    case "financialMatters":
      return doc.financialMatters;
    case "newOrOtherBusiness":
      return doc.newOrOtherBusiness;
    case "specialPresentations":
      return doc.specialPresentations;
    case "correspondence":
      return doc.correspondence;
    case "managementReport.itemsForRatification":
      return doc.managementReport.itemsForRatification;
    case "managementReport.itemsForApproval":
      return doc.managementReport.itemsForApproval;
    case "managementReport.itemsForInformation":
      return doc.managementReport.itemsForInformation;
    case "managementReport.itemsForDiscussion":
      return doc.managementReport.itemsForDiscussion;
    default:
      return null;
  }
}

function setItemsList(
  doc: MinutesDocumentV2,
  path: AgendaPath,
  items: AgendaItemV2[],
): MinutesDocumentV2 {
  const next = cloneDoc(doc);

  if (path.bucket === "postTerminationSections") {
    const sections = [...next.postTerminationSections];
    const section = { ...sections[path.sectionIndex] };
    section.items = items;
    sections[path.sectionIndex] = section;
    next.postTerminationSections = sections;
    return next;
  }

  switch (path.bucket) {
    case "financialMatters":
      next.financialMatters = items;
      break;
    case "newOrOtherBusiness":
      next.newOrOtherBusiness = items;
      break;
    case "specialPresentations":
      next.specialPresentations = items;
      break;
    case "correspondence":
      next.correspondence = items;
      break;
    case "managementReport.itemsForRatification":
      next.managementReport = {
        ...next.managementReport,
        itemsForRatification: items,
      };
      break;
    case "managementReport.itemsForApproval":
      next.managementReport = {
        ...next.managementReport,
        itemsForApproval: items,
      };
      break;
    case "managementReport.itemsForInformation":
      next.managementReport = {
        ...next.managementReport,
        itemsForInformation: items,
      };
      break;
    case "managementReport.itemsForDiscussion":
      next.managementReport = {
        ...next.managementReport,
        itemsForDiscussion: items,
      };
      break;
  }

  return next;
}

function rootIndex(path: AgendaPath): number {
  return path.bucket === "postTerminationSections"
    ? path.itemIndex
    : path.index;
}

function updateItemAtPath(
  items: AgendaItemV2[],
  index: number,
  subPath: number[] | undefined,
  updater: (item: AgendaItemV2) => AgendaItemV2,
): AgendaItemV2[] {
  const copy = [...items];
  if (!subPath?.length) {
    const current = copy[index];
    if (!current) return items;
    copy[index] = updater(current);
    return copy;
  }

  const current = copy[index];
  if (!current) return items;

  const [head, ...rest] = subPath;
  const subItems = updateItemAtPath(
    current.subItems,
    head,
    rest.length ? rest : undefined,
    updater,
  );
  copy[index] = { ...current, subItems };
  return copy;
}

function getItemAtPath(
  items: AgendaItemV2[],
  index: number,
  subPath: number[] | undefined,
): AgendaItemV2 | null {
  const item = items[index];
  if (!item) return null;
  if (!subPath?.length) return item;

  const [head, ...rest] = subPath;
  return getItemAtPath(item.subItems, head, rest.length ? rest : undefined);
}

export function updateAgendaItem(
  doc: MinutesDocumentV2,
  path: AgendaPath,
  patch: Partial<AgendaItemV2>,
): MinutesDocumentV2 {
  const items = getItemsList(doc, path);
  if (!items) return doc;

  const idx = rootIndex(path);
  const updated = updateItemAtPath(items, idx, path.subPath, (item) => ({
    ...item,
    ...patch,
  }));

  return setItemsList(doc, path, updated);
}

export function addAgendaItem(
  doc: MinutesDocumentV2,
  bucket: AgendaBucket | "postTerminationSections",
  item: AgendaItemV2 = emptyAgendaItem(),
  sectionIndex?: number,
): MinutesDocumentV2 {
  const next = cloneDoc(doc);

  if (bucket === "postTerminationSections") {
    if (sectionIndex === undefined) return doc;
    const sections = [...next.postTerminationSections];
    const section = { ...sections[sectionIndex] };
    section.items = [...section.items, item];
    sections[sectionIndex] = section;
    next.postTerminationSections = sections;
    return next;
  }

  switch (bucket) {
    case "financialMatters":
      next.financialMatters = [...next.financialMatters, item];
      break;
    case "newOrOtherBusiness":
      next.newOrOtherBusiness = [...next.newOrOtherBusiness, item];
      break;
    case "specialPresentations":
      next.specialPresentations = [...next.specialPresentations, item];
      break;
    case "correspondence":
      next.correspondence = [...next.correspondence, item];
      break;
    case "managementReport.itemsForRatification":
      next.managementReport = {
        ...next.managementReport,
        itemsForRatification: [
          ...next.managementReport.itemsForRatification,
          item,
        ],
      };
      break;
    case "managementReport.itemsForApproval":
      next.managementReport = {
        ...next.managementReport,
        itemsForApproval: [...next.managementReport.itemsForApproval, item],
      };
      break;
    case "managementReport.itemsForInformation":
      next.managementReport = {
        ...next.managementReport,
        itemsForInformation: [
          ...next.managementReport.itemsForInformation,
          item,
        ],
      };
      break;
    case "managementReport.itemsForDiscussion":
      next.managementReport = {
        ...next.managementReport,
        itemsForDiscussion: [
          ...next.managementReport.itemsForDiscussion,
          item,
        ],
      };
      break;
  }

  return next;
}

export function removeAgendaItem(
  doc: MinutesDocumentV2,
  path: AgendaPath,
): MinutesDocumentV2 {
  const items = getItemsList(doc, path);
  if (!items) return doc;

  const idx = rootIndex(path);

  if (path.subPath?.length) {
    const [head, ...rest] = path.subPath;
    const removeFromSub = (
      list: AgendaItemV2[],
      subIdx: number,
      remaining: number[],
    ): AgendaItemV2[] => {
      if (!remaining.length) {
        return list.filter((_, i) => i !== subIdx);
      }
      const copy = [...list];
      const parent = copy[subIdx];
      if (!parent) return list;
      copy[subIdx] = {
        ...parent,
        subItems: removeFromSub(
          parent.subItems,
          remaining[0],
          remaining.slice(1),
        ),
      };
      return copy;
    };
    const updatedItems = updateItemAtPath(items, idx, undefined, (item) => ({
      ...item,
      subItems: removeFromSub(item.subItems, head, rest),
    }));
    return setItemsList(doc, path, updatedItems);
  }

  const updated = items.filter((_, i) => i !== idx);
  return setItemsList(doc, path, updated);
}

export function moveAgendaItem(
  doc: MinutesDocumentV2,
  path: AgendaPath,
  direction: "up" | "down",
): MinutesDocumentV2 {
  const items = getItemsList(doc, path);
  if (!items || path.subPath?.length) return doc;

  const idx = rootIndex(path);
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= items.length) return doc;

  const copy = [...items];
  [copy[idx], copy[target]] = [copy[target], copy[idx]];
  return setItemsList(doc, path, copy);
}

export function updateMotion(
  doc: MinutesDocumentV2,
  path: AgendaPath,
  motion: MotionV2 | undefined,
): MinutesDocumentV2 {
  return updateAgendaItem(doc, path, { motion });
}

export function updateActionItem(
  doc: MinutesDocumentV2,
  path: AgendaPath,
  actionIndex: number,
  patch: Partial<ActionItemV2>,
): MinutesDocumentV2 {
  const items = getItemsList(doc, path);
  if (!items) return doc;

  const idx = rootIndex(path);
  return setItemsList(
    doc,
    path,
    updateItemAtPath(items, idx, path.subPath, (item) => {
      const actions = [...item.actionItems];
      const current = actions[actionIndex];
      if (!current) return item;
      actions[actionIndex] = { ...current, ...patch };
      return { ...item, actionItems: actions };
    }),
  );
}

export function addActionItem(
  doc: MinutesDocumentV2,
  path: AgendaPath,
): MinutesDocumentV2 {
  const items = getItemsList(doc, path);
  if (!items) return doc;

  const idx = rootIndex(path);
  return setItemsList(
    doc,
    path,
    updateItemAtPath(items, idx, path.subPath, (item) => ({
      ...item,
      actionItems: [...item.actionItems, emptyActionItem()],
    })),
  );
}

export function removeActionItem(
  doc: MinutesDocumentV2,
  path: AgendaPath,
  actionIndex: number,
): MinutesDocumentV2 {
  const items = getItemsList(doc, path);
  if (!items) return doc;

  const idx = rootIndex(path);
  return setItemsList(
    doc,
    path,
    updateItemAtPath(items, idx, path.subPath, (item) => ({
      ...item,
      actionItems: item.actionItems.filter((_, i) => i !== actionIndex),
    })),
  );
}

export function addSubItem(
  doc: MinutesDocumentV2,
  path: AgendaPath,
): MinutesDocumentV2 {
  const items = getItemsList(doc, path);
  if (!items) return doc;

  const idx = rootIndex(path);
  return setItemsList(
    doc,
    path,
    updateItemAtPath(items, idx, path.subPath, (item) => ({
      ...item,
      subItems: [...item.subItems, emptyAgendaItem()],
    })),
  );
}

export function updateCallToOrder(
  doc: MinutesDocumentV2,
  patch: Partial<CallToOrderV2>,
): MinutesDocumentV2 {
  return {
    ...doc,
    callToOrder: { ...doc.callToOrder, ...patch },
  };
}

export function updateDateOfNextMeeting(
  doc: MinutesDocumentV2,
  patch: Partial<DateOfNextMeetingV2>,
): MinutesDocumentV2 {
  return {
    ...doc,
    dateOfNextMeeting: { ...doc.dateOfNextMeeting, ...patch },
  };
}

export function updateTermination(
  doc: MinutesDocumentV2,
  time: string | undefined,
): MinutesDocumentV2 {
  return {
    ...doc,
    termination: time !== undefined ? { time } : doc.termination,
  };
}

export function updateApprovalOfPreviousMinutes(
  doc: MinutesDocumentV2,
  index: number,
  patch: Partial<ApprovalOfPreviousMinutesV2>,
): MinutesDocumentV2 {
  const approvals = [...doc.approvalOfPreviousMinutes];
  const current = approvals[index];
  if (!current) return doc;
  approvals[index] = { ...current, ...patch };
  return { ...doc, approvalOfPreviousMinutes: approvals };
}

export function addApprovalOfPreviousMinutes(
  doc: MinutesDocumentV2,
): MinutesDocumentV2 {
  return {
    ...doc,
    approvalOfPreviousMinutes: [
      ...doc.approvalOfPreviousMinutes,
      { amendmentsNoted: false },
    ],
  };
}

export function removeApprovalOfPreviousMinutes(
  doc: MinutesDocumentV2,
  index: number,
): MinutesDocumentV2 {
  return {
    ...doc,
    approvalOfPreviousMinutes: doc.approvalOfPreviousMinutes.filter(
      (_, i) => i !== index,
    ),
  };
}

export function updateApprovalMotion(
  doc: MinutesDocumentV2,
  index: number,
  motion: MotionV2 | undefined,
): MinutesDocumentV2 {
  return updateApprovalOfPreviousMinutes(doc, index, { motion });
}

/** Resolve item at path for read-only display helpers. */
export function readAgendaItemAtPath(
  doc: MinutesDocumentV2,
  path: AgendaPath,
): AgendaItemV2 | null {
  const items = getItemsList(doc, path);
  if (!items) return null;
  return getItemAtPath(items, rootIndex(path), path.subPath);
}
