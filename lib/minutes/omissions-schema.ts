import type { AgendaItemV2 } from "@/lib/minutes/schema-v2";
import { parseAgendaItemV2 } from "@/lib/minutes/schema-v2";

function newOmissionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const MINUTES_SECTION_PATHS = [
  "special_presentations",
  "financial_matters",
  "management_report.items_for_ratification",
  "management_report.items_for_approval",
  "management_report.items_for_information",
  "management_report.items_for_discussion",
  "correspondence",
  "new_or_other_business",
  "post_termination_sections",
] as const;

export type MinutesSectionPath = (typeof MINUTES_SECTION_PATHS)[number];

export const OMISSION_MERGE_ACTIONS = ["insert_new", "augment_existing"] as const;
export type OmissionMergeAction = (typeof OMISSION_MERGE_ACTIONS)[number];

export type OmissionFinding = {
  id: string;
  topic: string;
  missingDetail: string;
  whyItMatters: string;
  targetSection: MinutesSectionPath;
  /** insert_new = add agenda item; augment_existing = expand item at index */
  mergeAction: OmissionMergeAction;
  /** 0-based index in target_section array; required when mergeAction is augment_existing */
  existingItemIndex?: number;
  postTerminationTitle?: string;
  agendaItem: AgendaItemV2;
};

export const TODO_OMISSION_MERGE_ACTIONS = [
  "insert_new",
  "augment_existing",
] as const;
export type TodoOmissionMergeAction =
  (typeof TODO_OMISSION_MERGE_ACTIONS)[number];

export type TodoOmissionFinding = {
  id: string;
  assignee: string;
  role: string;
  missingDetail: string;
  whyItMatters: string;
  mergeAction: TodoOmissionMergeAction;
  /** 0-based index among this assignee's checklist items when augmenting */
  existingTaskIndex?: number;
  taskDescription: string;
  deadline?: string | null;
};

export type OmissionsAnalysisResult = {
  schemaVersion: "omissions_v1";
  analyzedAt: string;
  omissions: OmissionFinding[];
  todosOmissions: TodoOmissionFinding[];
  noSignificantOmissions?: boolean;
  noSignificantTodosOmissions?: boolean;
};

export type ValidateOmissionsAnalysisResult = {
  value: OmissionsAnalysisResult | null;
  warnings: string[];
  errors: string[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function isMinutesSectionPath(v: string): v is MinutesSectionPath {
  return (MINUTES_SECTION_PATHS as readonly string[]).includes(v);
}

function normalizeSectionPath(raw: unknown): MinutesSectionPath | null {
  const s = asString(raw);
  if (isMinutesSectionPath(s)) return s;
  const camel = s.replace(/([A-Z])/g, "_$1").toLowerCase();
  if (isMinutesSectionPath(camel)) return camel;
  return null;
}

function normalizeMergeAction(raw: unknown): OmissionMergeAction {
  const s = asString(raw);
  if (s === "augment_existing" || s === "insert_new") return s;
  return "insert_new";
}

function normalizeTodoMergeAction(raw: unknown): TodoOmissionMergeAction {
  const s = asString(raw);
  if (s === "augment_existing" || s === "insert_new") return s;
  return "insert_new";
}

function normalizeTodoOmissionFinding(
  raw: unknown,
  errors: string[],
  index: number,
): TodoOmissionFinding | null {
  if (!isRecord(raw)) {
    errors.push(`todos_omissions[${index}] must be an object.`);
    return null;
  }

  const assignee = asString(raw.assignee);
  const role = asString(raw.role) || "Board member";
  const missingDetail = asString(raw.missing_detail ?? raw.missingDetail);
  const whyItMatters = asString(raw.why_it_matters ?? raw.whyItMatters);
  const taskDescription = asString(
    raw.task_description ?? raw.taskDescription,
  );
  const mergeAction = normalizeTodoMergeAction(
    raw.merge_action ?? raw.mergeAction,
  );
  const existingTaskIndex = normalizeExistingItemIndex(
    raw.existing_task_index ?? raw.existingTaskIndex,
  );
  const deadlineRaw = raw.deadline;
  const deadline =
    deadlineRaw === null || deadlineRaw === undefined
      ? undefined
      : asString(deadlineRaw) || null;

  if (!assignee) errors.push(`todos_omissions[${index}] missing assignee.`);
  if (!missingDetail) {
    errors.push(`todos_omissions[${index}] missing missing_detail.`);
  }
  if (!whyItMatters) {
    errors.push(`todos_omissions[${index}] missing why_it_matters.`);
  }
  if (!taskDescription) {
    errors.push(`todos_omissions[${index}] missing task_description.`);
  }

  if (
    mergeAction === "augment_existing" &&
    existingTaskIndex === undefined
  ) {
    errors.push(
      `todos_omissions[${index}] requires existing_task_index when merge_action is augment_existing.`,
    );
  }

  if (!assignee || !missingDetail || !whyItMatters || !taskDescription) {
    return null;
  }

  if (mergeAction === "augment_existing" && existingTaskIndex === undefined) {
    return null;
  }

  const id = asString(raw.id) || newOmissionId();

  return {
    id,
    assignee,
    role,
    missingDetail,
    whyItMatters,
    mergeAction,
    taskDescription,
    ...(existingTaskIndex !== undefined ? { existingTaskIndex } : {}),
    ...(deadline !== undefined ? { deadline } : {}),
  };
}

function normalizeExistingItemIndex(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return undefined;
}

function normalizeOmissionFinding(
  raw: unknown,
  warnings: string[],
  errors: string[],
  index: number,
): OmissionFinding | null {
  if (!isRecord(raw)) {
    errors.push(`omissions[${index}] must be an object.`);
    return null;
  }

  const topic = asString(raw.topic);
  const missingDetail = asString(raw.missing_detail ?? raw.missingDetail);
  const whyItMatters = asString(raw.why_it_matters ?? raw.whyItMatters);
  const targetSection = normalizeSectionPath(
    raw.target_section ?? raw.targetSection,
  );
  const postTerminationTitle = asString(
    raw.post_termination_title ?? raw.postTerminationTitle,
  );
  const mergeAction = normalizeMergeAction(
    raw.merge_action ?? raw.mergeAction,
  );
  const existingItemIndex = normalizeExistingItemIndex(
    raw.existing_item_index ?? raw.existingItemIndex,
  );

  if (!topic) errors.push(`omissions[${index}] missing topic.`);
  if (!missingDetail) {
    errors.push(`omissions[${index}] missing missing_detail.`);
  }
  if (!whyItMatters) {
    errors.push(`omissions[${index}] missing why_it_matters.`);
  }
  if (!targetSection) {
    errors.push(`omissions[${index}] has invalid target_section.`);
  }

  const agendaRaw = raw.agenda_item ?? raw.agendaItem;
  const parsedItem = parseAgendaItemV2(agendaRaw);
  warnings.push(...parsedItem.warnings.map((w) => `omissions[${index}]: ${w}`));
  if (!parsedItem.value) {
    errors.push(
      ...parsedItem.errors.map((e) => `omissions[${index}]: ${e}`),
    );
  }

  if (
    targetSection === "post_termination_sections" &&
    !postTerminationTitle
  ) {
    errors.push(
      `omissions[${index}] requires post_termination_title when target_section is post_termination_sections.`,
    );
  }

  if (mergeAction === "augment_existing" && existingItemIndex === undefined) {
    errors.push(
      `omissions[${index}] requires existing_item_index when merge_action is augment_existing.`,
    );
  }

  if (
    !topic ||
    !missingDetail ||
    !whyItMatters ||
    !targetSection ||
    !parsedItem.value ||
    (mergeAction === "augment_existing" && existingItemIndex === undefined)
  ) {
    return null;
  }

  const id = asString(raw.id) || newOmissionId();

  return {
    id,
    topic,
    missingDetail,
    whyItMatters,
    targetSection,
    mergeAction,
    ...(existingItemIndex !== undefined ? { existingItemIndex } : {}),
    ...(postTerminationTitle
      ? { postTerminationTitle }
      : {}),
    agendaItem: parsedItem.value,
  };
}

/** Parse todos-only omissions JSON from the model. */
export function validateTodoOmissionsAnalysis(
  raw: unknown,
): ValidateOmissionsAnalysisResult {
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
        errors: ["Todos omissions analysis is not valid JSON."],
      };
    }
  }

  if (!isRecord(data)) {
    return { value: null, warnings, errors: ["Root must be a JSON object."] };
  }

  const schemaVersion = asString(data.schema_version ?? data.schemaVersion);
  if (
    schemaVersion !== "todos_omissions_v1" &&
    schemaVersion !== "omissions_v1"
  ) {
    errors.push(
      'schema_version must be "todos_omissions_v1" or "omissions_v1".',
    );
  }

  const analyzedAt = asString(data.analyzed_at ?? data.analyzedAt);
  if (!analyzedAt) {
    errors.push("analyzed_at is required.");
  }

  const omissionsRaw = data.omissions ?? data.todos_omissions ?? data.todosOmissions;
  if (omissionsRaw !== undefined && !Array.isArray(omissionsRaw)) {
    errors.push("omissions must be an array.");
    return { value: null, warnings, errors };
  }

  const todosOmissions: TodoOmissionFinding[] = [];
  if (Array.isArray(omissionsRaw)) {
    for (let i = 0; i < omissionsRaw.length; i += 1) {
      const finding = normalizeTodoOmissionFinding(
        omissionsRaw[i],
        errors,
        i,
      );
      if (finding) todosOmissions.push(finding);
    }
  }

  const noSignificantTodosOmissions =
    data.no_significant_omissions === true ||
    data.noSignificantOmissions === true ||
    data.no_significant_todos_omissions === true ||
    data.noSignificantTodosOmissions === true;

  if (errors.length > 0) {
    return { value: null, warnings, errors };
  }

  return {
    value: {
      schemaVersion: "omissions_v1",
      analyzedAt: analyzedAt || new Date().toISOString(),
      omissions: [],
      todosOmissions,
      ...(noSignificantTodosOmissions
        ? { noSignificantTodosOmissions: true }
        : {}),
    },
    warnings,
    errors: [],
  };
}

/** Parse and coerce unknown JSON into OmissionsAnalysisResult. */
export function validateOmissionsAnalysis(
  raw: unknown,
): ValidateOmissionsAnalysisResult {
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
        errors: ["Omissions analysis is not valid JSON."],
      };
    }
  }

  if (!isRecord(data)) {
    return { value: null, warnings, errors: ["Root must be a JSON object."] };
  }

  const schemaVersion = asString(data.schema_version ?? data.schemaVersion);
  if (schemaVersion !== "omissions_v1") {
    errors.push('schema_version must be "omissions_v1".');
  }

  const analyzedAt = asString(data.analyzed_at ?? data.analyzedAt);
  if (!analyzedAt) {
    errors.push("analyzed_at is required.");
  }

  const omissionsRaw = data.omissions;
  if (omissionsRaw !== undefined && !Array.isArray(omissionsRaw)) {
    errors.push("omissions must be an array.");
    return { value: null, warnings, errors };
  }

  const omissions: OmissionFinding[] = [];
  if (Array.isArray(omissionsRaw)) {
    for (let i = 0; i < omissionsRaw.length; i += 1) {
      const finding = normalizeOmissionFinding(
        omissionsRaw[i],
        warnings,
        errors,
        i,
      );
      if (finding) omissions.push(finding);
    }
  }

  const todosOmissionsRaw = data.todos_omissions ?? data.todosOmissions;
  if (todosOmissionsRaw !== undefined && !Array.isArray(todosOmissionsRaw)) {
    errors.push("todos_omissions must be an array.");
    return { value: null, warnings, errors };
  }

  const todosOmissions: TodoOmissionFinding[] = [];
  if (Array.isArray(todosOmissionsRaw)) {
    for (let i = 0; i < todosOmissionsRaw.length; i += 1) {
      const finding = normalizeTodoOmissionFinding(
        todosOmissionsRaw[i],
        errors,
        i,
      );
      if (finding) todosOmissions.push(finding);
    }
  }

  const noSignificantOmissions =
    data.no_significant_omissions === true ||
    data.noSignificantOmissions === true;

  const noSignificantTodosOmissions =
    data.no_significant_todos_omissions === true ||
    data.noSignificantTodosOmissions === true;

  if (errors.length > 0) {
    return { value: null, warnings, errors };
  }

  return {
    value: {
      schemaVersion: "omissions_v1",
      analyzedAt: analyzedAt || new Date().toISOString(),
      omissions,
      todosOmissions,
      ...(noSignificantOmissions ? { noSignificantOmissions: true } : {}),
      ...(noSignificantTodosOmissions
        ? { noSignificantTodosOmissions: true }
        : {}),
    },
    warnings,
    errors: [],
  };
}

/** Serialize for DB storage (snake_case for consistency with minutes envelope). */
export function serializeOmissionsAnalysis(
  analysis: OmissionsAnalysisResult,
): string {
  return JSON.stringify({
    schema_version: analysis.schemaVersion,
    analyzed_at: analysis.analyzedAt,
    omissions: analysis.omissions.map((o) => ({
      id: o.id,
      topic: o.topic,
      missing_detail: o.missingDetail,
      why_it_matters: o.whyItMatters,
      target_section: o.targetSection,
      merge_action: o.mergeAction,
      ...(o.existingItemIndex !== undefined
        ? { existing_item_index: o.existingItemIndex }
        : {}),
      ...(o.postTerminationTitle
        ? { post_termination_title: o.postTerminationTitle }
        : {}),
      agenda_item: {
        topic: o.agendaItem.topic,
        summary: o.agendaItem.summary,
        ...(o.agendaItem.costMentioned !== undefined
          ? { cost_mentioned: o.agendaItem.costMentioned }
          : {}),
        ...(o.agendaItem.contractorMentioned
          ? { contractor_mentioned: o.agendaItem.contractorMentioned }
          : {}),
        ...(o.agendaItem.motion
          ? {
              motion: {
                moved_by: o.agendaItem.motion.movedBy,
                seconded_by: o.agendaItem.motion.secondedBy,
                resolution_text: o.agendaItem.motion.resolutionText,
                status: o.agendaItem.motion.status,
              },
            }
          : {}),
        ...(o.agendaItem.actionItems.length
          ? {
              action_items: o.agendaItem.actionItems.map((a) => ({
                assignee: a.assignee,
                task_description: a.taskDescription,
              })),
            }
          : {}),
        ...(o.agendaItem.subItems.length
          ? {
              sub_items: o.agendaItem.subItems.map((s) => ({
                topic: s.topic,
                summary: s.summary,
              })),
            }
          : {}),
        ...(o.agendaItem.status ? { status: o.agendaItem.status } : {}),
        ...(o.agendaItem.restricted ? { restricted: true } : {}),
      },
    })),
    todos_omissions: analysis.todosOmissions.map((o) => ({
      id: o.id,
      assignee: o.assignee,
      role: o.role,
      missing_detail: o.missingDetail,
      why_it_matters: o.whyItMatters,
      merge_action: o.mergeAction,
      task_description: o.taskDescription,
      ...(o.existingTaskIndex !== undefined
        ? { existing_task_index: o.existingTaskIndex }
        : {}),
      ...(o.deadline !== undefined && o.deadline !== null
        ? { deadline: o.deadline }
        : {}),
    })),
    ...(analysis.noSignificantOmissions
      ? { no_significant_omissions: true }
      : {}),
    ...(analysis.noSignificantTodosOmissions
      ? { no_significant_todos_omissions: true }
      : {}),
  });
}

export function todoMergeActionLabel(
  action: TodoOmissionMergeAction,
  existingTaskIndex?: number,
): string {
  if (action === "augment_existing" && existingTaskIndex !== undefined) {
    return `Expand existing task #${existingTaskIndex + 1}`;
  }
  return "New checklist item";
}

/** Parse stored omissions JSON from DB. */
export function parseStoredOmissionsAnalysis(
  raw: string | null | undefined,
): OmissionsAnalysisResult | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = validateOmissionsAnalysis(parsed);
    return result.value;
  } catch {
    return null;
  }
}

export function sectionPathLabel(path: MinutesSectionPath): string {
  const labels: Record<MinutesSectionPath, string> = {
    special_presentations: "Special presentations",
    financial_matters: "Financial matters",
    "management_report.items_for_ratification": "Management — ratification",
    "management_report.items_for_approval": "Management — approval",
    "management_report.items_for_information": "Management — information",
    "management_report.items_for_discussion": "Management — discussion",
    correspondence: "Correspondence",
    new_or_other_business: "New / other business",
    post_termination_sections: "Post-termination",
  };
  return labels[path];
}

export function mergeActionLabel(
  action: OmissionMergeAction,
  existingItemIndex?: number,
): string {
  if (action === "augment_existing" && existingItemIndex !== undefined) {
    return `Expand existing item #${existingItemIndex + 1}`;
  }
  return "New agenda item";
}
