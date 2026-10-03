/**
 * Ordered V4 minutes outline.
 * Section numbers follow the order topics were discussed.
 * Presentations are one section; each presentation is a numbered subsection.
 * Markers are assigned before restricted items are moved to the addendum.
 */

import { parentAgendaItemCode } from "@/lib/meeting-v2/agenda-outline";
import { mapSuggestedSectionPath } from "@/lib/meeting-v2/draft-builder";
import type { MeetingsV4ItemResult, MeetingsV4MotionNote, MeetingsV4MotionOutcome } from "@/lib/meeting-v4/types";
import {
  RESTRICTED_ADDENDUM_DISCLAIMER,
  RESTRICTED_ADDENDUM_SECTION_HEADING,
  RESTRICTED_ADDENDUM_SUBTITLE,
  RESTRICTED_ADDENDUM_TITLE,
  markdownItalicizeCondominiumAct,
} from "@/lib/minutes/restricted-addendum-boilerplate";
import { stripLeadingThatFromResolution, type AttendanceV2 } from "@/lib/minutes/schema-v2";
import {
  formatAttendeeLine,
  formatMeetingDateDisplay,
  formatMeetingTimeClause,
  letterMarker,
  romanMarker,
} from "@/lib/minutes/v2-render-helpers";
import { CORP_LONG } from "@/lib/pdf/corporation";

/** One drafted row plus the agenda placement fields the outline reads. */
export type MeetingsV4OutlineItem = MeetingsV4ItemResult & {
  itemType: string;
  sectionLabel: string;
};

/** A named departure placed after the section where it happened. */
export type MeetingsV4Departure = {
  name: string;
  time?: string;
  role: "guest" | "recording_secretary";
  afterSectionId: string;
};

type GroupId = "ratification" | "approval" | "discussion" | "information" | "completed";

type Node = {
  item: MeetingsV4OutlineItem;
  children: Node[];
  displayIndex: number;
};

type Subsection = {
  group?: GroupId;
  title: string;
  intro: string;
  items: Node[];
  index: number;
  restricted: boolean;
};

type Section = {
  id: string;
  title: string;
  intro: string;
  prose: Node[];
  subsections: Subsection[];
  items: Node[];
  number: number;
};

const PROSE_IDS = new Set([
  "call_to_order",
  "approval_of_previous_minutes",
  "date_of_next_meeting",
  "conclusion",
]);

const MOTION_STATUS: Record<MeetingsV4MotionOutcome, string> = {
  carried: "Motion carried.",
  defeated: "Motion defeated.",
  deferred: "Deferred.",
  unrecorded: "Outcome not recorded.",
};

const GROUP_TITLE: Record<GroupId, string> = {
  ratification: "Items for Ratification",
  approval: "Items for Board Discussion and/or Approval",
  discussion: "Items for Board Discussion and/or Approval",
  information: "Items for Board Information",
  completed: "Work Completed",
};

/**
 * Markdown for one V4 draft.
 * Empty topics are omitted. Restricted items keep the numbers assigned on the full list.
 */
export function renderMeetingsV4Minutes(input: {
  meetingDate: string;
  items: readonly MeetingsV4OutlineItem[];
  attendance?: AttendanceV2;
  departures?: readonly MeetingsV4Departure[];
  meetingTime?: string;
}): string {
  const sections = numberSections(buildSections(input.items));
  const departures = input.departures ?? [];
  const lines: string[] = [openingLine(input.meetingDate, input.meetingTime), ""];
  lines.push(...attendanceLines(input.attendance));

  for (const section of sections) {
    const publicSection = publicView(section);
    if (!hasContent(publicSection)) continue;
    lines.push(...renderSection(publicSection, departures.filter((row) => row.afterSectionId === section.id)));
    lines.push("");
  }

  const addendum = sections
    .map(restrictedView)
    .filter(hasContent);
  if (addendum.length > 0) {
    lines.push(`## ${RESTRICTED_ADDENDUM_TITLE}`, "");
    lines.push(`### ${markdownItalicizeCondominiumAct(RESTRICTED_ADDENDUM_SUBTITLE)}`, "");
    lines.push(`***${RESTRICTED_ADDENDUM_SECTION_HEADING}***`, "");
    lines.push(markdownItalicizeCondominiumAct(RESTRICTED_ADDENDUM_DISCLAIMER), "");
    for (const section of addendum) {
      lines.push(...renderSection(section, [], true));
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function openingLine(meetingDate: string, meetingTime?: string): string {
  const date = formatMeetingDateDisplay(meetingDate);
  const when = date ? ` on ${date}` : "";
  const time = formatMeetingTimeClause(meetingTime);
  const sentence = `**MINUTES** of the meeting of the Board of Directors of ${CORP_LONG} held${when}${time}`;
  return time ? sentence : `${sentence}.`;
}

function attendanceLines(attendance: AttendanceV2 | undefined): string[] {
  if (!attendance) return [];
  const lines: string[] = [];
  const blocks: Array<[string, AttendanceV2["present"]]> = [
    ["Present:", attendance.present],
    ["By Invitation:", attendance.byInvitation],
    [attendance.guests.length > 1 ? "Guests:" : "Guest:", attendance.guests],
    ["Regrets:", attendance.regrets],
  ];
  for (const [label, people] of blocks) {
    if (!people.length) continue;
    lines.push(label);
    for (const person of people) lines.push(formatAttendeeLine(person));
    lines.push("");
  }
  return lines;
}

function buildSections(items: readonly MeetingsV4OutlineItem[]): Section[] {
  const sections: Section[] = [];
  for (const root of buildForest(items)) absorbRoot(sections, root);
  nameManagementGroups(sections);
  return sections;
}

function buildForest(items: readonly MeetingsV4OutlineItem[]): Node[] {
  const nodes = items.map((item) => ({ item, children: [] as Node[], displayIndex: 0 }));
  const numbers = items.map((item) => item.itemNumber);
  const duplicate = new Set(numbers).size !== numbers.length;
  const byNumber = new Map<string, Node>();
  if (!duplicate) {
    for (const node of nodes) {
      if (node.item.itemNumber) byNumber.set(node.item.itemNumber, node);
    }
  }
  const roots: Node[] = [];
  for (const node of nodes) {
    const parentKey = duplicate ? null : parentAgendaItemCode(node.item.itemNumber);
    const parent = parentKey ? byNumber.get(parentKey) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function absorbRoot(sections: Section[], node: Node): void {
  const id = sectionId(node.item);
  if (id === "presentations") {
    const section = ensureSection(sections, id);
    if (node.children.length > 0 && isSectionHeading(node)) {
      if (node.item.minutes?.trim()) section.intro = node.item.minutes.trim();
      for (const child of node.children) addPresentation(section, child);
      return;
    }
    addPresentation(section, node);
    return;
  }
  if (id === "management") {
    const section = ensureSection(sections, id);
    if (node.children.length > 0 && isSectionHeading(node)) {
      for (const child of node.children) placeManagement(section, child);
      return;
    }
    placeManagement(section, node);
    return;
  }
  const section = ensureSection(sections, id);
  if (PROSE_IDS.has(id)) {
    section.prose.push(node);
    return;
  }
  if (node.children.length > 0 && isSectionHeading(node)) {
    if (node.item.minutes?.trim()) section.intro = node.item.minutes.trim();
    section.items.push(...node.children);
    return;
  }
  section.items.push(node);
}

function addPresentation(section: Section, node: Node): void {
  section.subsections.push({
    title: node.item.title.trim() || "Presentation",
    intro: node.item.minutes?.trim() ?? "",
    items: node.children,
    index: section.subsections.length,
    restricted: node.item.restricted,
  });
}

function placeManagement(section: Section, node: Node): void {
  const group = groupId(node.item);
  if (node.children.length > 0 && isGroupHeading(node.item)) {
    const subsection = ensureGroup(section, group, node.item.title.trim());
    subsection.items.push(...node.children);
    return;
  }
  ensureGroup(section, group).items.push(node);
}

function ensureSection(sections: Section[], id: string): Section {
  const existing = sections.find((section) => section.id === id);
  if (existing) return existing;
  const created: Section = {
    id,
    title: sectionTitle(id),
    intro: "",
    prose: [],
    subsections: [],
    items: [],
    number: 0,
  };
  sections.push(created);
  return created;
}

function ensureGroup(section: Section, group: GroupId, title?: string): Subsection {
  const existing = section.subsections.find((subsection) => subsection.group === group);
  if (existing) {
    if (title?.trim()) existing.title = title.trim();
    return existing;
  }
  const created: Subsection = {
    group,
    title: title?.trim() || GROUP_TITLE[group],
    intro: "",
    items: [],
    index: section.subsections.length,
    restricted: false,
  };
  section.subsections.push(created);
  return created;
}

function nameManagementGroups(sections: Section[]): void {
  const management = sections.find((section) => section.id === "management");
  if (!management) return;
  const approval = management.subsections.find((subsection) => subsection.group === "approval");
  const discussion = management.subsections.find((subsection) => subsection.group === "discussion");
  if (approval && discussion && approval.title === GROUP_TITLE.approval) {
    approval.title = "Items for Review and Approval";
  }
}

function numberSections(sections: Section[]): Section[] {
  return sections.map((section, index) => {
    const numbered: Section = {
      ...section,
      number: index + 1,
      subsections: section.subsections.map((subsection, subsectionIndex) => ({
        ...subsection,
        index: subsectionIndex,
        items: stamp(subsection.items),
      })),
      items: stamp(section.items),
      prose: stamp(section.prose),
    };
    if (section.id === "management") stampAcrossGroups(numbered);
    return numbered;
  });
}

/** Management letters continue across subsections, matching 4.A then 4.C when 4.B is restricted. */
function stampAcrossGroups(section: Section): void {
  let displayIndex = 0;
  for (const subsection of section.subsections) {
    subsection.items = subsection.items.map((item) => ({
      ...item,
      displayIndex: displayIndex++,
      children: stamp(item.children),
    }));
  }
}

function stamp(items: Node[]): Node[] {
  return items.map((item, displayIndex) => ({
    ...item,
    displayIndex,
    children: stamp(item.children),
  }));
}

function publicView(section: Section): Section {
  return {
    ...section,
    prose: section.prose.filter((node) => !node.item.restricted),
    items: splitNodes(section.items).public,
    subsections: section.subsections
      .filter((subsection) => !subsection.restricted)
      .map((subsection) => ({ ...subsection, items: splitNodes(subsection.items).public }))
      .filter((subsection) => subsection.intro.trim() || subsection.items.length > 0),
  };
}

function restrictedView(section: Section): Section {
  const subsections = section.subsections.flatMap((subsection) => {
    if (subsection.restricted) return [subsection];
    const hidden = splitNodes(subsection.items).restricted;
    if (!hidden.length) return [];
    return [{ ...subsection, intro: "", items: hidden }];
  });
  return {
    ...section,
    intro: "",
    prose: section.prose.filter((node) => node.item.restricted),
    items: splitNodes(section.items).restricted,
    subsections,
  };
}

function splitNodes(items: Node[]): { public: Node[]; restricted: Node[] } {
  const pub: Node[] = [];
  const hidden: Node[] = [];
  for (const item of items) {
    if (item.item.restricted) {
      hidden.push(item);
      continue;
    }
    const children = splitNodes(item.children);
    pub.push({ ...item, children: children.public });
    if (children.restricted.length) {
      hidden.push({
        ...item,
        item: { ...item.item, minutes: "" },
        children: children.restricted,
      });
    }
  }
  return { public: pub, restricted: hidden };
}

function hasContent(section: Section): boolean {
  return Boolean(
    section.intro.trim()
    || section.prose.length
    || section.items.length
    || section.subsections.some((subsection) => subsection.intro.trim() || subsection.items.length),
  );
}

function renderSection(section: Section, departures: readonly MeetingsV4Departure[], continued = false): string[] {
  const title = continued ? `${section.title}, continued` : section.title;
  const lines = [`## ${section.number}. ${title.toUpperCase()}`, ""];
  if (!continued && section.intro.trim()) lines.push(section.intro.trim(), "");
  for (const node of section.prose) lines.push(...proseLines(section.id, node), "");
  for (const subsection of section.subsections) {
    lines.push(...renderSubsection(section.number, subsection), "");
  }
  lines.push(...renderItems(section.items, 0));
  for (const departure of departures) lines.push(departureLine(departure), "");
  return lines;
}

function renderSubsection(sectionNumber: number, subsection: Subsection): string[] {
  const number = `${sectionNumber}.${subsection.index + 1}`;
  const lines = [`### ${number} ${subsection.title}`];
  if (subsection.intro.trim()) {
    lines.push("");
    lines.push(subsection.intro.trim());
  }
  if (subsection.items.length) {
    lines.push("");
    lines.push(...renderItems(subsection.items, 0));
  }
  return lines;
}

function renderItems(items: Node[], depth: number): string[] {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(...renderItem(item, depth));
    lines.push("");
  }
  return lines;
}

function renderItem(item: Node, depth: number): string[] {
  const marker = depth > 0 ? romanMarker(item.displayIndex) : letterMarker(item.displayIndex);
  const pad = "  ".repeat(depth);
  const topic = item.item.title.trim();
  const body = item.item.minutes?.trim() ?? "";
  const lines = [`${pad}- **${marker}** ${topic}${body ? " –" : ""}`];
  const cont = `${pad}  `;
  if (body) lines.push(`${cont}${body}`);
  for (const action of item.item.actions) lines.push(`${cont}${actionLine(action)}`);
  for (const motionLine of motionLines(item.item.motion)) lines.push(`${cont}${motionLine}`);
  for (const child of item.children) {
    for (const line of renderItem(child, depth + 1)) lines.push(line);
  }
  return lines;
}

function proseLines(sectionId: string, node: Node): string[] {
  const raw = node.item.minutes?.trim() ?? "";
  const text = sectionId === "conclusion" ? dropUnanimously(raw) : raw;
  const lines: string[] = [];
  if (text) lines.push(text);
  lines.push(...motionLines(node.item.motion));
  return lines;
}

function actionLine(action: { owner: string | null; description: string }): string {
  const owner = action.owner?.trim() ?? "";
  const task = action.description.trim();
  const who = owner && owner.toLowerCase() !== "unassigned" ? `${owner} ` : "";
  return `**Action: ${who}${task}**`.replace(/\s+/g, " ");
}

function motionLines(motion: MeetingsV4MotionNote): string[] {
  const resolution = motion.resolution?.trim() ?? "";
  if (!resolution) return [];
  const lines = [`**MOTION${motion.mover?.trim() ? ` by ${motion.mover.trim()}` : ""}**`];
  if (motion.seconder?.trim()) lines.push(`**Seconded by ${motion.seconder.trim()}**`);
  lines.push(`**THAT ${stripLeadingThatFromResolution(resolution)}**`);
  lines.push(`**${MOTION_STATUS[motion.outcome] ?? "Outcome not recorded."}**`);
  return lines;
}

function departureLine(departure: MeetingsV4Departure): string {
  if (departure.role === "recording_secretary") return "The Recording Secretary was excused.";
  const name = departure.name.trim() || "The guest";
  const time = departure.time?.trim();
  if (!time) return `${name} was thanked for attending and departed the meeting.`;
  const clock = time.replace(/\.+$/, "");
  return `${name} was thanked for attending and departed the meeting at ${clock.endsWith(".") ? clock : `${clock}.`}`;
}

/** Removes the word unanimously from a conclusion sentence. */
export function dropUnanimously(text: string): string {
  return text.replace(/\s+\bunanimously\b/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

function sectionId(item: MeetingsV4OutlineItem): string {
  if (/^budget discussion$/i.test(item.title.trim())) return `post:${item.title.trim()}`;
  if (item.itemType === "completed_items" || /items completed|work completed/i.test(item.sectionLabel)) {
    return "management";
  }
  const path = mapSuggestedSectionPath({ itemType: item.itemType, sectionLabel: item.sectionLabel });
  if (path === "special_presentations") return "presentations";
  if (path === "termination") return "conclusion";
  if (path.startsWith("management_report.")) return "management";
  if (path === "call_to_order" || path === "approval_of_previous_minutes" || path === "financial_matters" || path === "correspondence" || path === "date_of_next_meeting") {
    return path;
  }
  return "new_or_other_business";
}

function sectionTitle(id: string): string {
  if (id.startsWith("post:")) return id.slice("post:".length);
  switch (id) {
    case "call_to_order":
      return "Call to Order";
    case "presentations":
      return "Presentation";
    case "approval_of_previous_minutes":
      return "Approval of Previous Minutes";
    case "financial_matters":
      return "Financial Matters";
    case "management":
      return "Management Report";
    case "correspondence":
      return "Correspondence";
    case "date_of_next_meeting":
      return "Date of Next Meeting";
    case "conclusion":
      return "Meeting Conclusion";
    default:
      return "New / Other Business";
  }
}

function groupId(item: MeetingsV4OutlineItem): GroupId {
  if (item.itemType === "completed_items" || /items completed|work completed/i.test(item.sectionLabel) || /^(items completed|work completed)/i.test(item.title.trim())) {
    return "completed";
  }
  const path = mapSuggestedSectionPath({ itemType: item.itemType, sectionLabel: item.sectionLabel });
  if (path.endsWith("items_for_ratification")) return "ratification";
  if (path.endsWith("items_for_approval")) return "approval";
  if (path.endsWith("items_for_information")) return "information";
  if (path.endsWith("items_for_discussion")) return "discussion";
  return "discussion";
}

function isSectionHeading(node: Node): boolean {
  const title = node.item.title.trim();
  return /^(presentation|special presentations|financial matters|management report|new \/ other business|correspondence)$/i.test(title);
}

function isGroupHeading(item: MeetingsV4OutlineItem): boolean {
  return /ratification|discussion and\/or approval|board information|work completed|items completed|review and approval/i.test(item.title);
}
