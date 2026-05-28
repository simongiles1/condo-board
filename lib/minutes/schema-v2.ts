/** Semantic meeting minutes schema (v2) for extraction + PDF rendering. */

export const AGENDA_ITEM_STATUS_VALUES = [
  "Motion carried.",
  "Motion defeated.",
  "Deferred.",
  "Pending.",
  "Information only.",
  "No action required.",
] as const;

export type AgendaItemStatus = (typeof AGENDA_ITEM_STATUS_VALUES)[number];

export type AttendeeV2 = {
  name: string;
  titleOrRole: string;
  company?: string;
};

export type MotionV2 = {
  movedBy: string;
  secondedBy: string;
  resolutionText: string;
  status: "Motion carried." | "Motion defeated." | "Deferred.";
};

/** Body after "THAT" — render/PDF add the keyword; models sometimes duplicate it. */
export function stripLeadingThatFromResolution(text: string): string {
  let t = text.trim();
  while (/^THAT\s+/i.test(t)) {
    t = t.replace(/^THAT\s+/i, "").trim();
  }
  return t;
}

export type ActionItemV2 = {
  assignee: string;
  taskDescription: string;
};

export type AgendaItemV2 = {
  topic: string;
  summary: string;
  costMentioned?: number;
  contractorMentioned?: string;
  motion?: MotionV2;
  actionItems: ActionItemV2[];
  subItems: AgendaItemV2[];
  status?: AgendaItemStatus;
  /**
   * True when this item is s. 55(4) confidential and must be rendered only in
   * the Restricted Records Addendum (omitted from the public minutes body).
   * Sub-items inherit their parent's flag — if the parent is restricted, all
   * descendants render in the addendum regardless of their own flag.
   */
  restricted?: boolean;
};

export type MetadataV2 = {
  corporationName: string;
  meetingDate: string;
  meetingTime: string;
  meetingLocation?: string;
  meetingPlatform?: string;
};

export type AttendanceV2 = {
  present: AttendeeV2[];
  byInvitation: AttendeeV2[];
  guests: AttendeeV2[];
  regrets: AttendeeV2[];
};

export type CallToOrderV2 = {
  time?: string;
  chairName?: string;
};

export type ApprovalOfPreviousMinutesV2 = {
  previousMeetingDate?: string;
  amendmentsNoted?: boolean;
  motion?: MotionV2;
};

export type ManagementReportV2 = {
  itemsForRatification: AgendaItemV2[];
  itemsForApproval: AgendaItemV2[];
  itemsForInformation: AgendaItemV2[];
  itemsForDiscussion: AgendaItemV2[];
};

export type DateOfNextMeetingV2 = {
  date?: string;
  time?: string;
  location?: string;
};

export type TerminationV2 = {
  time?: string;
};

export type PostTerminationSectionV2 = {
  title: string;
  items: AgendaItemV2[];
};

export type MinutesDocumentV2 = {
  metadata: MetadataV2;
  attendance: AttendanceV2;
  callToOrder?: CallToOrderV2;
  specialPresentations: AgendaItemV2[];
  approvalOfPreviousMinutes: ApprovalOfPreviousMinutesV2[];
  financialMatters: AgendaItemV2[];
  managementReport: ManagementReportV2;
  correspondence: AgendaItemV2[];
  newOrOtherBusiness: AgendaItemV2[];
  dateOfNextMeeting?: DateOfNextMeetingV2;
  termination?: TerminationV2;
  postTerminationSections: PostTerminationSectionV2[];
};

export type MinutesJsonEnvelopeV2 = {
  schema_version: "v2";
  data: MinutesDocumentV2;
};

export type ValidateMinutesV2Result = {
  value: MinutesDocumentV2 | null;
  warnings: string[];
  errors: string[];
};

const MAX_AGENDA_ITEM_DEPTH = 6;

/** Minimum raw JSON bytes below which output is treated as incomplete. */
export const MINUTES_V2_MIN_JSON_BYTES = 2500;

/** Minimum substantive agenda items expected from a full board meeting. */
export const MINUTES_V2_MIN_AGENDA_ITEMS = 3;

export function isAgendaItemEmpty(item: AgendaItemV2): boolean {
  return (
    !item.topic.trim() &&
    !item.summary.trim() &&
    !item.motion &&
    item.actionItems.length === 0 &&
    item.subItems.length === 0 &&
    !item.status
  );
}

export function filterAgendaItems(items: AgendaItemV2[]): AgendaItemV2[] {
  return items
    .filter((item) => !isAgendaItemEmpty(item))
    .map((item) => ({
      ...item,
      subItems: filterAgendaItems(item.subItems),
    }));
}

/**
 * Stable partition: items where `restricted` is falsy come first (in original
 * order); restricted items come last (in original order). Renderers rely on
 * this so public letter markers and addendum letter markers stay consistent
 * regardless of how the AI/editor ordered the array.
 */
export function reorderRestrictedLast(items: AgendaItemV2[]): AgendaItemV2[] {
  const pub: AgendaItemV2[] = [];
  const res: AgendaItemV2[] = [];
  for (const item of items) {
    if (item.restricted) res.push(item);
    else pub.push(item);
  }
  return [...pub, ...res];
}

/** Split a list into (public, restricted) preserving original order. */
export function partitionRestricted<T extends AgendaItemV2>(
  items: T[],
): { public: T[]; restricted: T[] } {
  const pub: T[] = [];
  const res: T[] = [];
  for (const item of items) {
    if (item.restricted) res.push(item);
    else pub.push(item);
  }
  return { public: pub, restricted: res };
}

function countItemsInList(items: AgendaItemV2[]): number {
  let count = 0;
  for (const item of items) {
    if (!isAgendaItemEmpty(item)) count += 1;
    count += countItemsInList(item.subItems);
  }
  return count;
}

/** Count agenda items with real content across the whole document. */
export function countSubstantiveAgendaItems(doc: MinutesDocumentV2): number {
  let count = 0;
  count += countItemsInList(doc.specialPresentations);
  count += countItemsInList(doc.financialMatters);
  count += countItemsInList(doc.correspondence);
  count += countItemsInList(doc.newOrOtherBusiness);
  count += countItemsInList(doc.managementReport.itemsForRatification);
  count += countItemsInList(doc.managementReport.itemsForApproval);
  count += countItemsInList(doc.managementReport.itemsForInformation);
  count += countItemsInList(doc.managementReport.itemsForDiscussion);
  for (const section of doc.postTerminationSections) {
    count += countItemsInList(section.items);
  }
  return count;
}

/** Heuristic: model returned a skeleton instead of full minutes. */
export function isMinutesV2TooSparse(
  doc: MinutesDocumentV2,
  rawJsonLength = 0,
): boolean {
  const agendaCount = countSubstantiveAgendaItems(doc);
  if (rawJsonLength > 0 && rawJsonLength < MINUTES_V2_MIN_JSON_BYTES) {
    return true;
  }
  if (agendaCount < MINUTES_V2_MIN_AGENDA_ITEMS) {
    return true;
  }
  return false;
}

export function sanitizeMinutesDocumentV2(doc: MinutesDocumentV2): MinutesDocumentV2 {
  const mr = doc.managementReport;
  return {
    ...doc,
    specialPresentations: reorderRestrictedLast(
      filterAgendaItems(doc.specialPresentations),
    ),
    financialMatters: reorderRestrictedLast(
      filterAgendaItems(doc.financialMatters),
    ),
    correspondence: reorderRestrictedLast(
      filterAgendaItems(doc.correspondence),
    ),
    newOrOtherBusiness: reorderRestrictedLast(
      filterAgendaItems(doc.newOrOtherBusiness),
    ),
    postTerminationSections: doc.postTerminationSections
      .map((section) => ({
        ...section,
        items: reorderRestrictedLast(filterAgendaItems(section.items)),
      }))
      .filter((section) => section.title.trim() || section.items.length > 0),
    managementReport: {
      itemsForRatification: reorderRestrictedLast(
        filterAgendaItems(mr.itemsForRatification),
      ),
      itemsForApproval: reorderRestrictedLast(
        filterAgendaItems(mr.itemsForApproval),
      ),
      itemsForInformation: reorderRestrictedLast(
        filterAgendaItems(mr.itemsForInformation),
      ),
      itemsForDiscussion: reorderRestrictedLast(
        filterAgendaItems(mr.itemsForDiscussion),
      ),
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function asOptionalString(v: unknown): string | undefined {
  const s = asString(v);
  return s || undefined;
}

function asOptionalNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asOptionalBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function normalizeAttendee(raw: unknown, warnings: string[]): AttendeeV2 {
  if (!isRecord(raw)) {
    warnings.push("Attendee entry was not an object.");
    return { name: "", titleOrRole: "" };
  }
  const name = asString(raw.name);
  const titleOrRole = asString(raw.title_or_role ?? raw.titleOrRole ?? raw.role);
  const company = asOptionalString(raw.company);
  if (!name) warnings.push("Attendee missing name.");
  if (!titleOrRole) warnings.push(`Attendee "${name || "(unknown)"}" missing title_or_role.`);
  return { name, titleOrRole, company };
}

function normalizeMotion(raw: unknown, warnings: string[]): MotionV2 | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    warnings.push("Motion was not an object; ignored.");
    return undefined;
  }
  const movedBy = asString(raw.moved_by ?? raw.movedBy ?? raw.mover);
  const secondedBy = asString(raw.seconded_by ?? raw.secondedBy ?? raw.seconder);
  const resolutionText = stripLeadingThatFromResolution(
    asString(raw.resolution_text ?? raw.resolutionText ?? raw.resolution),
  );
  const statusRaw = asString(raw.status ?? raw.outcome, "Motion carried.");
  const status: MotionV2["status"] =
    statusRaw === "Motion defeated." || statusRaw === "Deferred."
      ? statusRaw
      : "Motion carried.";

  if (!movedBy || !secondedBy || !resolutionText) {
    warnings.push("Motion missing required fields.");
  }

  return { movedBy, secondedBy, resolutionText, status };
}

function normalizeActionItem(raw: unknown, warnings: string[]): ActionItemV2 {
  if (!isRecord(raw)) {
    warnings.push("Action item was not an object.");
    return { assignee: "", taskDescription: "" };
  }
  return {
    assignee: asString(raw.assignee),
    taskDescription: asString(raw.task_description ?? raw.taskDescription ?? raw.text),
  };
}

function normalizeAgendaItemStatus(raw: unknown): AgendaItemStatus | undefined {
  const s = asString(raw);
  if (!s) return undefined;
  if ((AGENDA_ITEM_STATUS_VALUES as readonly string[]).includes(s)) {
    return s as AgendaItemStatus;
  }
  return undefined;
}

function normalizeAgendaItem(
  raw: unknown,
  warnings: string[],
  depth = 0,
): AgendaItemV2 {
  if (!isRecord(raw)) {
    warnings.push("Agenda item was not an object.");
    return { topic: "", summary: "", actionItems: [], subItems: [] };
  }

  const topic = asString(raw.topic);
  const summary = asString(raw.summary);
  if (!topic && !summary && !raw.motion && !raw.action_items && !raw.actionItems && !raw.sub_items && !raw.subItems) {
    return { topic: "", summary: "", actionItems: [], subItems: [] };
  }
  if (!topic) warnings.push("Agenda item missing topic.");
  if (!summary) warnings.push(`Agenda item "${topic || "(unknown)"}" missing summary.`);

  const actionItemsRaw = raw.action_items ?? raw.actionItems;
  const actionItems: ActionItemV2[] = Array.isArray(actionItemsRaw)
    ? actionItemsRaw.map((a) => normalizeActionItem(a, warnings))
    : [];

  let subItems: AgendaItemV2[] = [];
  const subItemsRaw = raw.sub_items ?? raw.subItems;
  if (Array.isArray(subItemsRaw)) {
    if (depth >= MAX_AGENDA_ITEM_DEPTH) {
      warnings.push(`Agenda item "${topic}" exceeds max sub-item depth; truncated.`);
    } else {
      subItems = subItemsRaw.map((s) =>
        normalizeAgendaItem(s, warnings, depth + 1),
      );
    }
  }

  return {
    topic,
    summary,
    costMentioned: asOptionalNumber(raw.cost_mentioned ?? raw.costMentioned),
    contractorMentioned: asOptionalString(
      raw.contractor_mentioned ?? raw.contractorMentioned,
    ),
    motion: normalizeMotion(raw.motion, warnings),
    actionItems,
    subItems,
    status: normalizeAgendaItemStatus(raw.status),
    restricted: asOptionalBoolean(raw.restricted),
  };
}

function normalizeAgendaItems(
  raw: unknown,
  warnings: string[],
  fieldName: string,
): AgendaItemV2[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${fieldName} must be an array; coerced to [].`);
    return [];
  }
  return raw.map((item) => normalizeAgendaItem(item, warnings));
}

function normalizeAttendees(raw: unknown, warnings: string[], fieldName: string): AttendeeV2[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${fieldName} must be an array; coerced to [].`);
    return [];
  }
  return raw.map((a) => normalizeAttendee(a, warnings));
}

function normalizeManagementReport(
  raw: unknown,
  warnings: string[],
): ManagementReportV2 {
  if (!isRecord(raw)) {
    warnings.push("management_report was not an object; using empty buckets.");
    return {
      itemsForRatification: [],
      itemsForApproval: [],
      itemsForInformation: [],
      itemsForDiscussion: [],
    };
  }
  return {
    itemsForRatification: normalizeAgendaItems(
      raw.items_for_ratification ?? raw.itemsForRatification,
      warnings,
      "items_for_ratification",
    ),
    itemsForApproval: normalizeAgendaItems(
      raw.items_for_approval ?? raw.itemsForApproval,
      warnings,
      "items_for_approval",
    ),
    itemsForInformation: normalizeAgendaItems(
      raw.items_for_information ?? raw.itemsForInformation,
      warnings,
      "items_for_information",
    ),
    itemsForDiscussion: normalizeAgendaItems(
      raw.items_for_discussion ?? raw.itemsForDiscussion,
      warnings,
      "items_for_discussion",
    ),
  };
}

function tagRestricted(items: AgendaItemV2[]): AgendaItemV2[] {
  return items.map((item) => ({ ...item, restricted: true }));
}

/**
 * Legacy-shape migration: fold a `restricted_records_addendum` object (v2.0)
 * into the new inline `restricted: true` flag (v2.1). Items from
 * `management_report_continued` go into their matching buckets; standalone
 * `other_confidential_matters` items default into items_for_approval.
 */
function migrateLegacyRestrictedAddendum(
  raw: unknown,
  warnings: string[],
  mr: ManagementReportV2,
): ManagementReportV2 {
  if (raw === undefined || raw === null) return mr;
  if (!isRecord(raw)) return mr;

  warnings.push(
    "Migrated legacy restricted_records_addendum into inline restricted=true flags.",
  );

  const mrcRaw = raw.management_report_continued ?? raw.managementReportContinued;
  const otherRaw =
    raw.other_confidential_matters ?? raw.otherConfidentialMatters;

  const migrated: ManagementReportV2 = {
    itemsForRatification: [...mr.itemsForRatification],
    itemsForApproval: [...mr.itemsForApproval],
    itemsForInformation: [...mr.itemsForInformation],
    itemsForDiscussion: [...mr.itemsForDiscussion],
  };

  if (isRecord(mrcRaw)) {
    migrated.itemsForRatification.push(
      ...tagRestricted(
        normalizeAgendaItems(
          mrcRaw.items_for_ratification ?? mrcRaw.itemsForRatification,
          warnings,
          "addendum.items_for_ratification",
        ),
      ),
    );
    migrated.itemsForApproval.push(
      ...tagRestricted(
        normalizeAgendaItems(
          mrcRaw.items_for_approval ?? mrcRaw.itemsForApproval,
          warnings,
          "addendum.items_for_approval",
        ),
      ),
    );
    migrated.itemsForDiscussion.push(
      ...tagRestricted(
        normalizeAgendaItems(
          mrcRaw.items_for_discussion ?? mrcRaw.itemsForDiscussion,
          warnings,
          "addendum.items_for_discussion",
        ),
      ),
    );
  }

  if (Array.isArray(otherRaw)) {
    migrated.itemsForApproval.push(
      ...tagRestricted(
        normalizeAgendaItems(otherRaw, warnings, "other_confidential_matters"),
      ),
    );
  }

  return migrated;
}

function normalizePostTerminationSections(
  raw: unknown,
  warnings: string[],
): PostTerminationSectionV2[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push("post_termination_sections must be an array; coerced to [].");
    return [];
  }
  return raw.map((entry, idx) => {
    if (!isRecord(entry)) {
      warnings.push(`post_termination_sections[${idx}] was not an object.`);
      return { title: "", items: [] };
    }
    return {
      title: asString(entry.title),
      items: normalizeAgendaItems(entry.items, warnings, `post_termination_sections[${idx}].items`),
    };
  });
}

/** Parse and coerce a single agenda item (e.g. omissions merge payload). */
export function parseAgendaItemV2(raw: unknown): {
  value: AgendaItemV2 | null;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const item = normalizeAgendaItem(raw, warnings);
  if (isAgendaItemEmpty(item) || !item.topic.trim() || !item.summary.trim()) {
    return {
      value: null,
      warnings,
      errors: ["Agenda item missing topic or summary."],
    };
  }
  return { value: item, warnings, errors: [] };
}

/** Parse and coerce unknown JSON into MinutesDocumentV2. */
export function validateMinutesV2(raw: unknown): ValidateMinutesV2Result {
  const warnings: string[] = [];
  const errors: string[] = [];

  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return {
        value: null,
        warnings,
        errors: ["minutes_json is not valid JSON."],
      };
    }
  }

  if (!isRecord(data)) {
    return { value: null, warnings, errors: ["Root must be a JSON object."] };
  }

  if (
    data.schema_version === "v2" &&
    isRecord(data.data) &&
    !isRecord(data.metadata)
  ) {
    warnings.push(
      "Unwrapped { schema_version, data } envelope around minutes document.",
    );
    data = data.data;
  }

  if (!isRecord(data)) {
    return { value: null, warnings, errors: ["Root must be a JSON object."] };
  }

  const metaRaw = data.metadata;
  if (!isRecord(metaRaw)) {
    errors.push("metadata is required.");
  }

  const corporationName = isRecord(metaRaw)
    ? asString(metaRaw.corporation_name ?? metaRaw.corporationName)
    : "";
  const meetingDate = isRecord(metaRaw)
    ? asString(metaRaw.meeting_date ?? metaRaw.meetingDate)
    : "";
  const meetingTime = isRecord(metaRaw)
    ? asString(metaRaw.meeting_time ?? metaRaw.meetingTime)
    : "";

  if (!corporationName) errors.push("metadata.corporation_name is required.");
  if (!meetingDate) errors.push("metadata.meeting_date is required.");
  if (!meetingTime) {
    warnings.push("metadata.meeting_time empty; PDF may show blank time.");
  }

  const attendanceRaw = data.attendance;
  if (!isRecord(attendanceRaw)) {
    warnings.push("attendance missing; using empty lists.");
  }

  const attendance: AttendanceV2 = {
    present: normalizeAttendees(
      isRecord(attendanceRaw) ? attendanceRaw.present : [],
      warnings,
      "attendance.present",
    ),
    byInvitation: normalizeAttendees(
      isRecord(attendanceRaw) ? attendanceRaw.by_invitation ?? attendanceRaw.byInvitation : [],
      warnings,
      "attendance.by_invitation",
    ),
    guests: normalizeAttendees(
      isRecord(attendanceRaw) ? attendanceRaw.guests : [],
      warnings,
      "attendance.guests",
    ),
    regrets: normalizeAttendees(
      isRecord(attendanceRaw) ? attendanceRaw.regrets : [],
      warnings,
      "attendance.regrets",
    ),
  };

  let callToOrder: CallToOrderV2 | undefined;
  const ctoRaw = data.call_to_order ?? data.callToOrder;
  if (isRecord(ctoRaw)) {
    callToOrder = {
      time: asOptionalString(ctoRaw.time),
      chairName: asOptionalString(ctoRaw.chair_name ?? ctoRaw.chairName),
    };
  }

  const approvalRaw = data.approval_of_previous_minutes ?? data.approvalOfPreviousMinutes;
  const approvalOfPreviousMinutes: ApprovalOfPreviousMinutesV2[] = Array.isArray(approvalRaw)
    ? approvalRaw.map((entry) => {
        if (!isRecord(entry)) {
          warnings.push("approval_of_previous_minutes entry was not an object.");
          return {};
        }
        return {
          previousMeetingDate: asOptionalString(
            entry.previous_meeting_date ?? entry.previousMeetingDate,
          ),
          amendmentsNoted: asOptionalBoolean(
            entry.amendments_noted ?? entry.amendmentsNoted,
          ),
          motion: normalizeMotion(entry.motion, warnings),
        };
      })
    : [];

  let dateOfNextMeeting: DateOfNextMeetingV2 | undefined;
  const nextRaw = data.date_of_next_meeting ?? data.dateOfNextMeeting;
  if (isRecord(nextRaw)) {
    dateOfNextMeeting = {
      date: asOptionalString(nextRaw.date),
      time: asOptionalString(nextRaw.time),
      location: asOptionalString(nextRaw.location),
    };
  }

  let termination: TerminationV2 | undefined;
  const termRaw = data.termination;
  if (isRecord(termRaw)) {
    termination = { time: asOptionalString(termRaw.time) };
  }

  if (errors.length > 0) {
    return { value: null, warnings, errors };
  }

  const baseManagementReport = normalizeManagementReport(
    data.management_report ?? data.managementReport,
    warnings,
  );

  const managementReport = migrateLegacyRestrictedAddendum(
    data.restricted_records_addendum ?? data.restrictedRecordsAddendum,
    warnings,
    baseManagementReport,
  );

  const value: MinutesDocumentV2 = sanitizeMinutesDocumentV2({
    metadata: {
      corporationName,
      meetingDate,
      meetingTime,
      meetingLocation: isRecord(metaRaw)
        ? asOptionalString(metaRaw.meeting_location ?? metaRaw.meetingLocation)
        : undefined,
      meetingPlatform: isRecord(metaRaw)
        ? asOptionalString(metaRaw.meeting_platform ?? metaRaw.meetingPlatform)
        : undefined,
    },
    attendance,
    callToOrder,
    specialPresentations: normalizeAgendaItems(
      data.special_presentations ?? data.specialPresentations,
      warnings,
      "special_presentations",
    ),
    approvalOfPreviousMinutes,
    financialMatters: normalizeAgendaItems(
      data.financial_matters ?? data.financialMatters,
      warnings,
      "financial_matters",
    ),
    managementReport,
    correspondence: normalizeAgendaItems(
      data.correspondence,
      warnings,
      "correspondence",
    ),
    newOrOtherBusiness: normalizeAgendaItems(
      data.new_or_other_business ?? data.newOrOtherBusiness,
      warnings,
      "new_or_other_business",
    ),
    dateOfNextMeeting,
    termination,
    postTerminationSections: normalizePostTerminationSections(
      data.post_termination_sections ?? data.postTerminationSections,
      warnings,
    ),
  });

  return { value, warnings, errors };
}

/** Parse stored minutes_json envelope or bare v2 document. */
export function parseMinutesJsonEnvelope(raw: string): {
  version: "v1" | "v2" | null;
  v2: MinutesDocumentV2 | null;
  v1Raw: unknown;
  warnings: string[];
  errors: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      version: null,
      v2: null,
      v1Raw: null,
      warnings: [],
      errors: ["minutes_json is not valid JSON."],
    };
  }

  if (isRecord(parsed) && parsed.schema_version === "v2" && isRecord(parsed.data)) {
    const validated = validateMinutesV2(parsed.data);
    return {
      version: "v2",
      v2: validated.value,
      v1Raw: null,
      warnings: validated.warnings,
      errors: validated.errors,
    };
  }

  if (isRecord(parsed) && parsed.sections !== undefined) {
    return {
      version: "v1",
      v2: null,
      v1Raw: parsed,
      warnings: [],
      errors: [],
    };
  }

  const validated = validateMinutesV2(parsed);
  if (validated.value) {
    return {
      version: "v2",
      v2: validated.value,
      v1Raw: null,
      warnings: validated.warnings,
      errors: validated.errors,
    };
  }

  return {
    version: null,
    v2: null,
    v1Raw: parsed,
    warnings: validated.warnings,
    errors: validated.errors,
  };
}

/** Transcript cues that usually require a restricted addendum. */
export const RESTRICTED_TRANSCRIPT_HINTS =
  /\bsuite\s*#?\s*\d{3,4}\b|\bunit\s+#?\s*\d{3,4}\b|\bholdback\b|\begis\s+engineering\b|\blash\s+condo\s+law\b|\bhighline\s+glass\b|\bcompliance\s+(letter|notice)\b|\bmeturgy\b|\bshared\s+facilities\s+reserve\b|\baccess\s+refusal\b|\bwater\s+(sub-)?meter\b|\bowner\s+liabilit/i;

const RESTRICTED_CONTENT_IN_PUBLIC_HINTS =
  /\bunit\s+\d{3,4}\b|\bsuite\s+\d{3,4}\b|\bholdback\s+of\s+\$|\b\d{1,3},\d{3}\.\d{2}\s+to\s+new\s+water\b|\begis\s+engineering\b|\blash\s+condo\s+law\b|\bcompliance\s+letter\b|\bs\.\s*55\s*\(\s*4\s*\)/i;

function anyRestrictedInList(items: AgendaItemV2[]): boolean {
  for (const item of items) {
    if (item.restricted) return true;
    if (anyRestrictedInList(item.subItems)) return true;
  }
  return false;
}

/** True when the document has at least one restricted item with content. */
export function hasAnyRestrictedItem(doc: MinutesDocumentV2): boolean {
  if (anyRestrictedInList(doc.specialPresentations)) return true;
  if (anyRestrictedInList(doc.financialMatters)) return true;
  if (anyRestrictedInList(doc.correspondence)) return true;
  if (anyRestrictedInList(doc.newOrOtherBusiness)) return true;
  if (anyRestrictedInList(doc.managementReport.itemsForRatification)) return true;
  if (anyRestrictedInList(doc.managementReport.itemsForApproval)) return true;
  if (anyRestrictedInList(doc.managementReport.itemsForInformation)) return true;
  if (anyRestrictedInList(doc.managementReport.itemsForDiscussion)) return true;
  for (const section of doc.postTerminationSections) {
    if (anyRestrictedInList(section.items)) return true;
  }
  return false;
}

/** Serialize only the public-facing items (excluding restricted) for hint scans. */
function publicMinutesBlob(doc: MinutesDocumentV2): string {
  function stripRestricted(items: AgendaItemV2[]): AgendaItemV2[] {
    return items
      .filter((i) => !i.restricted)
      .map((i) => ({ ...i, subItems: stripRestricted(i.subItems) }));
  }
  const publicDoc: MinutesDocumentV2 = {
    ...doc,
    specialPresentations: stripRestricted(doc.specialPresentations),
    financialMatters: stripRestricted(doc.financialMatters),
    correspondence: stripRestricted(doc.correspondence),
    newOrOtherBusiness: stripRestricted(doc.newOrOtherBusiness),
    managementReport: {
      itemsForRatification: stripRestricted(doc.managementReport.itemsForRatification),
      itemsForApproval: stripRestricted(doc.managementReport.itemsForApproval),
      itemsForInformation: stripRestricted(doc.managementReport.itemsForInformation),
      itemsForDiscussion: stripRestricted(doc.managementReport.itemsForDiscussion),
    },
    postTerminationSections: doc.postTerminationSections.map((s) => ({
      ...s,
      items: stripRestricted(s.items),
    })),
  };
  return JSON.stringify(publicDoc).toLowerCase();
}

/** True when generation should retry to flag restricted items. */
export function shouldRetryForRestrictedAddendum(
  doc: MinutesDocumentV2,
  transcript: string,
  parseWarnings: string[] = [],
): boolean {
  if (hasAnyRestrictedItem(doc)) return false;

  if (
    parseWarnings.some((w) =>
      w.includes("restricted") || w.includes("addendum"),
    )
  ) {
    return true;
  }

  if (RESTRICTED_TRANSCRIPT_HINTS.test(transcript)) {
    return true;
  }

  if (RESTRICTED_CONTENT_IN_PUBLIC_HINTS.test(publicMinutesBlob(doc))) {
    return true;
  }

  return false;
}

/** Heuristic checks after structural validation. */
export function detectMinutesV2Issues(doc: MinutesDocumentV2): string[] {
  const w: string[] = [];

  let motionCount = 0;
  function walkItems(items: AgendaItemV2[]) {
    for (const item of items) {
      if (item.motion) motionCount += 1;
      walkItems(item.subItems);
    }
  }

  walkItems(doc.financialMatters);
  walkItems(doc.specialPresentations);
  walkItems(doc.correspondence);
  walkItems(doc.newOrOtherBusiness);
  walkItems(doc.managementReport.itemsForRatification);
  walkItems(doc.managementReport.itemsForApproval);
  walkItems(doc.managementReport.itemsForInformation);
  walkItems(doc.managementReport.itemsForDiscussion);
  for (const approval of doc.approvalOfPreviousMinutes) {
    if (approval.motion) motionCount += 1;
  }
  for (const section of doc.postTerminationSections) {
    walkItems(section.items);
  }

  if (motionCount === 0) {
    w.push("No motions detected in structured minutes.");
  }

  const publicBlob = publicMinutesBlob(doc);
  if (
    RESTRICTED_CONTENT_IN_PUBLIC_HINTS.test(publicBlob) &&
    !hasAnyRestrictedItem(doc)
  ) {
    w.push(
      "Restricted topics (suite numbers, holdback settlement, legal disputes, etc.) appear in public minutes but no items are flagged restricted=true.",
    );
  } else if (
    RESTRICTED_CONTENT_IN_PUBLIC_HINTS.test(publicBlob) &&
    hasAnyRestrictedItem(doc)
  ) {
    w.push(
      "Public minutes still mention restricted topics by name — verify suite numbers and dollar figures are sequestered to restricted=true items.",
    );
  }

  const fullBlob = JSON.stringify(doc).toLowerCase();
  if (
    fullBlob.length < 800 &&
    !doc.termination?.time &&
    !/concluded|adjourned/.test(fullBlob)
  ) {
    w.push("Minutes JSON looks short and may lack meeting conclusion.");
  }

  return w;
}

export function wrapMinutesV2(data: MinutesDocumentV2): MinutesJsonEnvelopeV2 {
  return { schema_version: "v2", data };
}
