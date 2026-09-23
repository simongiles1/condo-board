import {
  clickableAnswers,
  openQuestionStorageId,
  userAnswerForOpenQuestion,
  type InvestigationOpenQuestion,
  type OpenQuestionContextNote,
} from "./investigation-contract";

type FactCandidate = { value: string; sourceId: string; quote: string };

type FactLike = {
  field: string;
  scope: string;
  candidates: FactCandidate[];
  selected: number | null;
};

/** Fact ledger plus the processing failures salvage recorded instead of user questions. */
export type FactResolutionLike = {
  facts: FactLike[];
  unresolvedQuestions: string[];
  processingFailures?: ProcessingFailure[];
};

/** One software failure the secretary retries instead of answering. */
export type ProcessingFailure = {
  id: string;
  field: string;
  label: string;
  detail: string;
};

/** One meeting question, keyed so rewording keeps the saved answer. */
export type ReviewQuestion = {
  id: string;
  prompt: string;
  options: string[];
  notes: OpenQuestionContextNote[];
  effect: string;
};

const PROCESSING_TEXT =
  /^(Could not use |Could not verify |Fact resolution failed|Fact resolution contains|Fact resolution returned|Fact .+ has a missing|Automatic investigation)/i;

const PACKAGE_CONFLICT_TEXT =
  /^Could not (accept package evidence|treat a package proposal)\b/i;

/**
 * True when text is a pipeline failure rather than a question about the meeting.
 */
export function isProcessingFailureText(value: string): boolean {
  return PROCESSING_TEXT.test(value.trim());
}

/**
 * True when the secretary should retry processing instead of typing an answer.
 */
export function isRetryNotAnswerText(value: string): boolean {
  const trimmed = value.trim();
  return isProcessingFailureText(trimmed) || PACKAGE_CONFLICT_TEXT.test(trimmed);
}

/**
 * Stable id for one fact, shared by prior-approval and current-decision rows.
 */
export function factStorageId(scope: string, field: string): string {
  const scopeKey = scope.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "discussion";
  const fieldKey = field.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "field";
  return `fact:${scopeKey}:${fieldKey}`;
}

/**
 * Saved text for a review question, preferring its stable id over older prompt wording.
 */
export function storedAnswerForReviewQuestion(
  question: Pick<ReviewQuestion, "id" | "prompt">,
  answers: Record<string, string>,
): string {
  const byId = answers[question.id];
  if (typeof byId === "string" && byId.trim()) return byId;
  return userAnswerForOpenQuestion(question.prompt, answers) ?? "";
}

/**
 * True when the fact ledger should be resolved once more before investigation repair.
 * Human questions do not trigger another pass.
 */
export function ledgerNeedsBoundedReresolve(
  resolution: FactResolutionLike | null | undefined,
  alreadyRetried: boolean,
): boolean {
  if (alreadyRetried || !resolution) return false;
  if ((resolution.processingFailures?.length ?? 0) > 0) return true;
  return resolution.unresolvedQuestions.some((question) => isProcessingFailureText(question));
}

function noteSource(sourceId: string): OpenQuestionContextNote["source"] {
  const raw = sourceId.toLowerCase();
  if (raw.startsWith("transcript")) return "transcript";
  if (raw.startsWith("document") || raw.startsWith("package")) return "package";
  return "both";
}

function pushNote(notes: OpenQuestionContextNote[], fact: string, source: OpenQuestionContextNote["source"]) {
  const cleaned = fact.replace(/\s+/g, " ").trim();
  if (!cleaned || notes.some((note) => note.fact === cleaned)) return;
  notes.push({ fact: cleaned, source });
}

function promptForFact(fact: FactLike): string {
  const topic = fact.field.replace(/_/g, " ");
  if (fact.scope === "prior_approval") return `Was ${topic} already decided before this meeting?`;
  if (fact.scope === "current_decision") return `What did the board decide at this meeting about ${topic}?`;
  if (fact.scope === "package_proposal") return `Which package value should the minutes use for ${topic}?`;
  return `What did the discussion establish for ${topic}?`;
}

function effectForFact(fact: FactLike): string {
  if (fact.scope === "prior_approval") return "This determines whether the minutes record an earlier decision.";
  if (fact.scope === "current_decision") return "This determines whether the minutes record a decision from this meeting.";
  if (fact.scope === "package_proposal") return "This determines which package figure or name the minutes mention.";
  return "This determines what the minutes say was discussed.";
}

function fieldTokens(field: string): string[] {
  return field.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
}

function mentionsFact(question: string, fact: FactLike): boolean {
  const text = question.toLowerCase();
  const tokens = fieldTokens(fact.field);
  const mentionsField = tokens.some((token) => text.includes(token));
  const aboutApproval = /\bapprov/.test(fact.field.toLowerCase()) && /\bapprov/.test(text);
  if (!mentionsField && !aboutApproval) return false;
  const earlier = /earlier|previous|prior|last meeting|already/.test(text);
  const current = /this meeting|today|current/.test(text);
  if (fact.scope === "prior_approval") return earlier || (!current && (mentionsField || aboutApproval));
  if (fact.scope === "current_decision") return current || (!earlier && (mentionsField || aboutApproval));
  return mentionsField || aboutApproval;
}

/** Builds a processing failure row from a stored pipeline error string. */
export function failureFromText(text: string, index: number): ProcessingFailure {
  const named = text.match(/\bfor ([^.]+)\.$/);
  const field = named?.[1]?.trim() || "fact record";
  const slug = field.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fact";
  return {
    id: `processing:${slug}:${index}`,
    field,
    label: `${field} needs another processing pass.`,
    detail: text,
  };
}

/**
 * Meeting questions and processing failures for one agenda item.
 * One unselected fact becomes one question. Wording that asks the same fact again is folded into its notes.
 */
export function buildItemReviewQuestions(input: {
  factResolution: FactResolutionLike | null | undefined;
  openQuestions?: InvestigationOpenQuestion[];
}): { questions: ReviewQuestion[]; processingFailures: ProcessingFailure[] } {
  const resolution = input.factResolution;
  const processingFailures: ProcessingFailure[] = [...(resolution?.processingFailures ?? [])];
  const seenFailure = new Set(processingFailures.map((failure) => failure.detail));
  for (const question of resolution?.unresolvedQuestions ?? []) {
    if (!isProcessingFailureText(question) || seenFailure.has(question)) continue;
    processingFailures.push(failureFromText(question, processingFailures.length));
    seenFailure.add(question);
  }

  const failedFields = new Set(processingFailures.map((failure) => failure.field));
  const built: Array<{ fact: FactLike; question: ReviewQuestion }> = [];
  for (const fact of resolution?.facts ?? []) {
    if (fact.selected !== null || failedFields.has(fact.field) || fact.candidates.length === 0) continue;
    const options = [...new Set(fact.candidates.map((candidate) => candidate.value.trim()).filter(Boolean))].slice(0, 4);
    if (fact.scope === "current_decision" && !options.includes("No decision at this meeting")) {
      options.push("No decision at this meeting");
    }
    const notes: OpenQuestionContextNote[] = [];
    for (const candidate of fact.candidates) {
      pushNote(notes, candidate.quote || candidate.value, noteSource(candidate.sourceId));
    }
    built.push({
      fact,
      question: {
        id: factStorageId(fact.scope, fact.field),
        prompt: promptForFact(fact),
        options,
        notes,
        effect: effectForFact(fact),
      },
    });
  }

  const loose: ReviewQuestion[] = [];
  const absorb = (text: string, notes: OpenQuestionContextNote[], options: string[]) => {
    const hits = built.filter((entry) => mentionsFact(text, entry.fact));
    if (hits.length !== 1) {
      loose.push({
        id: openQuestionStorageId(text),
        prompt: text,
        options: options.slice(0, 4),
        notes,
        effect: "This answer is added to the next investigation of this item.",
      });
      return;
    }
    const target = hits[0].question;
    for (const note of notes) pushNote(target.notes, note.fact, note.source);
    for (const option of options) {
      if (option && !target.options.includes(option) && target.options.length < 4) target.options.push(option);
    }
    if (!target.notes.some((note) => note.fact === text)) {
      pushNote(target.notes, text, "both");
    }
  };

  for (const question of resolution?.unresolvedQuestions ?? []) {
    if (isProcessingFailureText(question) || PACKAGE_CONFLICT_TEXT.test(question.trim())) continue;
    absorb(question, [], []);
  }
  for (const question of input.openQuestions ?? []) {
    const text = question.question;
    if (isRetryNotAnswerText(text)) {
      if (!seenFailure.has(text)) {
        processingFailures.push(failureFromText(text, processingFailures.length));
        seenFailure.add(text);
      }
      continue;
    }
    absorb(text, question.context_notes, clickableAnswers(question));
  }

  const questions = [...built.map((entry) => entry.question), ...loose];
  const seen = new Set<string>();
  return {
    questions: questions.filter((question) => {
      if (seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    }),
    processingFailures,
  };
}

type DrawerClarificationSource = {
  reviewQuestions?: ReviewQuestion[];
  processingFailures?: ProcessingFailure[];
  factClarificationsNeeded?: string[];
  openQuestions: string[];
  openQuestionNotes?: OpenQuestionContextNote[][];
  openQuestionOptions?: string[][];
  openQuestionContext?: Record<string, OpenQuestionContextNote[]>;
};

/**
 * Normalizes API payloads so the drawer never shows pipeline errors as answer boxes.
 */
export function normalizeDrawerClarifications(
  item: DrawerClarificationSource,
): { reviewQuestions: ReviewQuestion[]; processingFailures: ProcessingFailure[] } {
  const mergeFailureText = (text: string, failures: ProcessingFailure[], seen: Set<string>) => {
    if (!isRetryNotAnswerText(text) || seen.has(text)) return;
    failures.push(failureFromText(text, failures.length));
    seen.add(text);
  };

  const serverHasUnifiedModel =
    item.reviewQuestions !== undefined || item.processingFailures !== undefined;

  if (serverHasUnifiedModel) {
    const seen = new Set((item.processingFailures ?? []).map((failure) => failure.detail));
    const processingFailures = [...(item.processingFailures ?? [])];
    for (const text of item.factClarificationsNeeded ?? []) {
      mergeFailureText(text, processingFailures, seen);
    }
    const reviewQuestions = [...(item.reviewQuestions ?? [])];
    const humanFactPrompts = (item.factClarificationsNeeded ?? []).filter((text) => !isRetryNotAnswerText(text));
    for (const text of humanFactPrompts) {
      if (reviewQuestions.some((question) => question.prompt === text)) continue;
      reviewQuestions.push({
        id: openQuestionStorageId(text),
        prompt: text,
        options: [],
        notes: item.openQuestionContext?.[text] ?? [],
        effect: "This answer is added to the next investigation of this item.",
      });
    }
    return { reviewQuestions, processingFailures };
  }

  const processingFailures: ProcessingFailure[] = [];
  const seen = new Set<string>();
  const humanOpenQuestions: string[] = [];
  for (let index = 0; index < item.openQuestions.length; index += 1) {
    const text = item.openQuestions[index];
    if (isRetryNotAnswerText(text)) {
      mergeFailureText(text, processingFailures, seen);
      continue;
    }
    humanOpenQuestions.push(text);
  }
  for (const text of item.factClarificationsNeeded ?? []) {
    if (isRetryNotAnswerText(text)) mergeFailureText(text, processingFailures, seen);
  }

  const reviewQuestions: ReviewQuestion[] = [];
  for (const text of humanOpenQuestions) {
    const index = item.openQuestions.indexOf(text);
    reviewQuestions.push({
      id: openQuestionStorageId(text),
      prompt: text,
      options: item.openQuestionOptions?.[index] ?? [],
      notes:
        item.openQuestionNotes?.[index]?.length
          ? item.openQuestionNotes[index]
          : item.openQuestionContext?.[text] ?? [],
      effect: "This answer is added to the next investigation of this item.",
    });
  }
  for (const text of (item.factClarificationsNeeded ?? []).filter((entry) => !isRetryNotAnswerText(entry))) {
    if (reviewQuestions.some((question) => question.prompt === text)) continue;
    reviewQuestions.push({
      id: openQuestionStorageId(text),
      prompt: text,
      options: [],
      notes: item.openQuestionContext?.[text] ?? [],
      effect: "This answer is added to the next investigation of this item.",
    });
  }

  return { reviewQuestions, processingFailures };
}
