/** Where a question briefing bullet was drawn from. */
export type OpenQuestionFactSource = "transcript" | "package" | "both";

/** One rewritten fact that helps a person answer an open question. */
export type OpenQuestionContextNote = {
  fact: string;
  source: OpenQuestionFactSource;
};

/** One unresolved investigation question, including a recommended answer and briefing notes. */
export type InvestigationOpenQuestion = {
  question: string;
  recommended_answer: string;
  confidence: "high" | "medium" | "low";
  context_notes: OpenQuestionContextNote[];
};

export type InvestigationDocument = {
  discussion_summary: string;
  outcome: "APPROVED" | "REJECTED" | "DEFERRED" | "NO_DECISION" | "INFORMATION_ONLY" | "UNCLEAR";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  visibility: "PUBLIC" | "RESTRICTED" | "UNKNOWN";
  decisions: string[];
  motion: {
    moved_by: string | null; seconded_by: string | null; resolution_text: string | null;
    result: "CARRIED" | "DEFEATED" | "DEFERRED" | "UNKNOWN";
    is_candidate?: boolean; is_informal?: boolean;
  } | null;
  actions: Array<{ owner: string | null; description: string; due_date: string | null }>;
  open_questions: InvestigationOpenQuestion[];
  revised_notes?: string[];
};

export function canonicalEnum(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected a JSON object.");
  return v as Record<string, unknown>;
};
const text = (v: unknown): string => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
const nullable = (v: unknown) => text(v) || null;
const strings = (v: unknown): string[] => {
  if (!Array.isArray(v) || !v.every(s => typeof s === "string")) throw new Error("Expected a string array.");
  return v.map(text).filter(Boolean);
};
function enumValue<T extends string>(value: unknown, choices: readonly T[]): T {
  const normalized = canonicalEnum(value);
  if (!choices.includes(normalized as T)) throw new Error(`Invalid investigation enum: ${normalized || "missing"}.`);
  return normalized as T;
}

function parseFactSource(value: unknown): OpenQuestionFactSource | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (raw === "transcript" || raw === "meeting_transcript") return "transcript";
  if (raw === "package" || raw === "board_package" || raw === "meeting_package" || raw === "document") return "package";
  if (raw === "both" || raw === "transcript_and_package" || raw === "hybrid") return "both";
  return null;
}

/**
 * Parses briefing bullets on an open question, ignoring empty or unsourced entries.
 */
export function parseOpenQuestionContextNotes(value: unknown): OpenQuestionContextNote[] {
  if (!Array.isArray(value)) return [];
  const notes: OpenQuestionContextNote[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const fact = text(row.fact ?? row.text ?? row.note);
    const source = parseFactSource(row.source);
    if (!fact || !source) continue;
    notes.push({ fact, source });
    if (notes.length >= 8) break;
  }
  return notes;
}

function parseOpenQuestion(value: unknown): InvestigationOpenQuestion | null {
  if (typeof value === "string") {
    const question = text(value);
    return question ? { question, recommended_answer: "", confidence: "low", context_notes: [] } : null;
  }
  const question = record(value);
  const textValue = text(question.question);
  if (!textValue) return null;
  const confidence = canonicalEnum(question.confidence);
  return {
    question: textValue,
    recommended_answer: text(question.recommended_answer),
    confidence: confidence === "HIGH" ? "high" : confidence === "MEDIUM" ? "medium" : "low",
    context_notes: parseOpenQuestionContextNotes(question.context_notes ?? question.briefing),
  };
}

/**
 * Reads stored `open_questions_json`, accepting legacy string arrays and object rows.
 */
export function parseStoredOpenQuestions(raw: string | null | undefined): InvestigationOpenQuestion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      try {
        const question = parseOpenQuestion(entry);
        return question ? [question] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/**
 * Returns only the question strings from stored investigation JSON.
 */
export function storedOpenQuestionTexts(raw: string | null | undefined): string[] {
  return parseStoredOpenQuestions(raw).map((entry) => entry.question);
}

/**
 * Serializes open questions for `open_questions_json` without dropping briefing notes.
 */
export function serializeOpenQuestionsJson(questions: InvestigationOpenQuestion[]): string {
  return JSON.stringify(
    questions.map((question) => ({
      question: question.question,
      context_notes: question.context_notes,
    })),
  );
}

/**
 * Keeps prior briefing notes when a later pass omitted them.
 */
export function mergeOpenQuestionContextNotes(
  previous: InvestigationOpenQuestion[],
  next: InvestigationOpenQuestion[],
): InvestigationOpenQuestion[] {
  const prior = new Map(previous.map((question) => [question.question, question.context_notes]));
  return next.map((question) =>
    question.context_notes.length > 0
      ? question
      : { ...question, context_notes: prior.get(question.question) ?? [] },
  );
}

/**
 * True when at least one open question still has no briefing bullets.
 */
export function openQuestionsMissingContextNotes(questions: InvestigationOpenQuestion[]): boolean {
  return questions.some((question) => question.context_notes.length === 0);
}

/** Malformed model output is a failed stage, never a package-derived success. */
export function parseInvestigation(value: unknown): InvestigationDocument {
  const r = record(value);
  const summary = text(r.discussion_summary);
  if (!summary || !Array.isArray(r.actions) || !Array.isArray(r.open_questions) || r.motion === undefined) {
    throw new Error("Investigation is incomplete.");
  }
  const motion = r.motion === null ? null : record(r.motion);
  const result = motion ? enumValue(motion.result, ["CARRIED", "DEFEATED", "DEFERRED", "UNKNOWN"] as const) : null;
  return {
    discussion_summary: summary,
    outcome: enumValue(r.outcome, ["APPROVED", "REJECTED", "DEFERRED", "NO_DECISION", "INFORMATION_ONLY", "UNCLEAR"] as const),
    confidence: enumValue(r.confidence, ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"] as const),
    visibility: enumValue(r.visibility, ["PUBLIC", "RESTRICTED", "UNKNOWN"] as const),
    decisions: strings(r.decisions),
    motion: motion ? { moved_by: nullable(motion.moved_by), seconded_by: nullable(motion.seconded_by),
      resolution_text: nullable(motion.resolution_text), result: result!,
      is_candidate: motion.is_candidate === true || result === "UNKNOWN", is_informal: motion.is_informal === true } : null,
    actions: r.actions.map(a => { const action = record(a); if (!text(action.description)) throw new Error("Action has no description.");
      return { owner: nullable(action.owner), description: text(action.description), due_date: nullable(action.due_date) }; }),
    open_questions: r.open_questions.map(q => {
      const parsed = parseOpenQuestion(q);
      if (!parsed) throw new Error("Question is empty.");
      return parsed;
    }),
    revised_notes: r.revised_notes === undefined ? undefined : strings(r.revised_notes),
  };
}
