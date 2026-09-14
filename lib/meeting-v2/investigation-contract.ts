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
  open_questions: Array<{ question: string; recommended_answer: string; confidence: "high" | "medium" | "low" }>;
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
    open_questions: r.open_questions.map(q => { const question = record(q); if (!text(question.question)) throw new Error("Question is empty.");
      return { question: text(question.question), recommended_answer: text(question.recommended_answer),
        confidence: (canonicalEnum(question.confidence) === "HIGH" ? "high" : canonicalEnum(question.confidence) === "MEDIUM" ? "medium" : "low") as "high" | "medium" | "low" }; }),
    revised_notes: r.revised_notes === undefined ? undefined : strings(r.revised_notes),
  };
}
