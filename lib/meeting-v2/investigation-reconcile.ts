/**
 * Post-investigation helpers: skip redundant wrap-up injection, rewrite
 * package notes the transcript contradicted, and keep guest outline items
 * from absorbing later PM-report resolutions.
 */

import { dollarAmounts, isSpokenThousandsTruncation, type EvidenceSource, type FactResolution } from "./evidence-contract";
import {
  parseOpenQuestionContextNotes,
  type InvestigationOpenQuestion,
  type OpenQuestionContextNote,
  type OpenQuestionFactSource,
} from "./investigation-contract";

const GENERIC_FACT_TOKENS = new Set([
  "board",
  "corporation",
  "counsel",
  "engineer",
  "legal",
  "management",
  "meeting",
]);

export const GUEST_PRESENTATION_ITEM_TYPE = "guest_presentation";

export const GUEST_PRESENTATION_LATER_RESOLUTION_REASON =
  "Guest-presentation outline items stay on the passing mention. Later Property Management Report resolutions belong to the later agenda slot.";

export function isGuestPresentationItem(itemType: string | null | undefined): boolean {
  return (itemType ?? "").trim().toLowerCase() === GUEST_PRESENTATION_ITEM_TYPE;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractMoneyAmountKeys(text: string): string[] {
  const keys = new Set<string>();
  const money = text.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g);
  for (const match of money) {
    const raw = match[1]?.replace(/,/g, "") ?? "";
    if (!raw) continue;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 100) continue;
    keys.add(String(Math.round(numeric)));
  }
  return [...keys];
}

function properFactTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/\b([A-Z]{2,}|\p{Lu}[\p{L}'-]+)\b/gu)) {
    const token = match[1] ?? "";
    if (!token || GENERIC_FACT_TOKENS.has(token.toLowerCase())) continue;
    tokens.push(token.toLowerCase());
  }
  return tokens;
}

/**
 * True when the recommended answer adds a concrete fact (amount or named
 * party) that is not already in the discussion summary.
 */
export function recommendedAnswerAddsNewFact(summary: string, answer: string): boolean {
  const normalizedAnswer = normalizeWhitespace(answer);
  if (!normalizedAnswer) return false;

  const summaryFacts = new Set([
    ...extractMoneyAmountKeys(summary),
    ...properFactTokens(summary),
  ]);
  const answerFacts = [
    ...extractMoneyAmountKeys(normalizedAnswer),
    ...properFactTokens(normalizedAnswer),
  ];
  return answerFacts.some((fact) => !summaryFacts.has(fact));
}

const FORMALITY_GAP = /\b(formal approval|formally approved|mover|seconder|seconded|recorded vote|no motion|without a (?:motion|vote|seconder|mover))\b/i;
const SUBSTANTIVE_CHOICE = /\b(which (?:contractor|amount|quote|option|vendor)|or for|versus|how does it relate|instead of)\b/i;
const CHOICE_LANGUAGE = /\b(?:\bor\b|versus|vs\.?|how does it relate|instead of)\b/i;

/**
 * True when the question only asks whether missing motion language blocks a decision.
 * A question that also asks the reader to choose between substantive alternatives stays.
 */
export function isFormalityGapQuestion(question: string): boolean {
  return FORMALITY_GAP.test(question) && !SUBSTANTIVE_CHOICE.test(question);
}

function selectedDecisionAmounts(facts: FactResolution): number[] {
  const amounts: number[] = [];
  for (const fact of facts.facts) {
    if (fact.selected == null) continue;
    if (fact.scope !== "prior_approval" && fact.scope !== "current_decision") continue;
    const selected = fact.candidates[fact.selected];
    if (!selected) continue;
    amounts.push(...dollarAmounts(selected.value));
  }
  return amounts;
}

function unadoptedPackageAmounts(facts: FactResolution, decided: number[]): number[] {
  const amounts: number[] = [];
  for (const fact of facts.facts) {
    if (fact.scope !== "package_proposal") continue;
    for (const candidate of fact.candidates) {
      for (const amount of dollarAmounts(candidate.value)) {
        const adopted = decided.some(
          (decision) => Math.abs(decision - amount) < 0.001
            || isSpokenThousandsTruncation(amount, decision)
            || isSpokenThousandsTruncation(decision, amount),
        );
        if (!adopted) amounts.push(amount);
      }
    }
  }
  return amounts;
}

/**
 * Drops questions that only exist because a motion was not recited, and questions
 * that ask the reader to choose an unadopted package figure after a decision amount
 * is already selected and the fact ledger has nothing unresolved.
 */
export function omitBlockedOpenQuestions(
  questions: InvestigationOpenQuestion[],
  factResolution: FactResolution | null | undefined,
): InvestigationOpenQuestion[] {
  const ledgerClear = !factResolution || factResolution.unresolvedQuestions.length === 0;
  const decided = factResolution ? selectedDecisionAmounts(factResolution) : [];
  const unadopted = factResolution && decided.length > 0 ? unadoptedPackageAmounts(factResolution, decided) : [];
  return questions.filter((question) => {
    if (isFormalityGapQuestion(question.question)) return false;
    if (!ledgerClear || unadopted.length === 0 || !CHOICE_LANGUAGE.test(question.question)) return true;
    const asked = dollarAmounts(question.question);
    return !asked.some((amount) => unadopted.some((proposal) => Math.abs(proposal - amount) < 0.001));
  });
}

export function replaceLabeledLine(text: string, label: string, value: string | null): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)${escaped}:\\s*.+$`, "im");
  if (value == null || value.trim() === "") {
    return text.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  const line = `${label}: ${value}`;
  if (pattern.test(text)) {
    return text.replace(pattern, (match) => (match.startsWith("\n") ? `\n${line}` : line));
  }
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n${line}` : line;
}

export function applyRevisedNotes(options: {
  notes: string[];
  sourceText: string;
  assembledContextText: string;
}): { notes: string[]; sourceText: string; assembledContextText: string } {
  const notes = options.notes.map((note) => normalizeWhitespace(note)).filter(Boolean);
  const notesValue = notes.length > 0 ? notes.join("; ") : null;
  return {
    notes,
    sourceText: replaceLabeledLine(options.sourceText, "Notes", notesValue),
    assembledContextText: replaceLabeledLine(options.assembledContextText, "Notes", notesValue),
  };
}

function sourceFromId(sourceId: string): OpenQuestionFactSource {
  const raw = sourceId.trim().toLowerCase();
  if (raw.startsWith("transcript")) return "transcript";
  if (raw.startsWith("document") || raw.startsWith("package")) return "package";
  return "both";
}

function meaningfulTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z0-9$]{3,}/g)) {
    const token = match[0] ?? "";
    if (!token || GENERIC_FACT_TOKENS.has(token)) continue;
    tokens.add(token);
  }
  for (const amount of extractMoneyAmountKeys(text)) tokens.add(amount);
  return tokens;
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function pushNote(notes: OpenQuestionContextNote[], fact: string, source: OpenQuestionFactSource) {
  const cleaned = normalizeWhitespace(fact);
  if (!cleaned) return;
  if (notes.some((note) => note.fact === cleaned)) return;
  notes.push({ fact: cleaned, source });
}

/**
 * Builds secretary briefing bullets from the fact ledger and labeled sources
 * when the investigator omitted context_notes.
 */
export function fallbackContextNotesForQuestion(options: {
  question: string;
  factResolution: FactResolution | null | undefined;
  sources: EvidenceSource[];
}): OpenQuestionContextNote[] {
  const notes: OpenQuestionContextNote[] = [];
  const questionTokens = meaningfulTokens(options.question);
  const facts = options.factResolution?.facts ?? [];
  const rankedFacts = facts
    .map((fact) => {
      const selected = fact.selected == null ? null : fact.candidates[fact.selected] ?? null;
      const haystack = [fact.field, fact.scope, fact.explanation, selected?.value ?? "", selected?.quote ?? ""].join(" ");
      return { fact, selected, score: overlapCount(questionTokens, meaningfulTokens(haystack)) };
    })
    .sort((a, b) => b.score - a.score);

  for (const row of rankedFacts) {
    if (notes.length >= 6) break;
    if (row.score === 0 && notes.length >= 2) continue;
    const selected = row.selected;
    if (selected) {
      const scope =
        row.fact.scope === "prior_approval"
          ? "Prior approval"
          : row.fact.scope === "package_proposal"
            ? "Board package"
            : row.fact.scope === "current_decision"
              ? "This meeting"
              : "Discussion";
      pushNote(
        notes,
        `${scope}: ${row.fact.field.replace(/_/g, " ")} is ${selected.value}. ${row.fact.explanation}`.trim(),
        sourceFromId(selected.sourceId),
      );
    } else if (row.fact.candidates[0]) {
      pushNote(
        notes,
        `Unresolved ${row.fact.field.replace(/_/g, " ")}: candidates include ${row.fact.candidates.map((candidate) => candidate.value).slice(0, 3).join("; ")}.`,
        sourceFromId(row.fact.candidates[0].sourceId),
      );
    }
  }

  for (const unresolved of options.factResolution?.unresolvedQuestions ?? []) {
    if (notes.length >= 6) break;
    if (overlapCount(questionTokens, meaningfulTokens(unresolved)) === 0) continue;
    pushNote(notes, unresolved, "both");
  }

  const rankedSources = options.sources
    .map((source) => ({ source, score: overlapCount(questionTokens, meaningfulTokens(source.text)) }))
    .sort((a, b) => b.score - a.score);
  for (const row of rankedSources) {
    if (notes.length >= 6) break;
    if (row.score === 0 && notes.length >= 2) continue;
    const snippet = normalizeWhitespace(row.source.text).slice(0, 280);
    if (!snippet) continue;
    pushNote(notes, snippet, row.source.kind === "transcript" ? "transcript" : row.source.kind === "document" ? "package" : "both");
  }

  return notes.slice(0, 6);
}

/**
 * Applies fallback briefing notes to any open question that still has none.
 */
export function applyFallbackQuestionContextNotes(options: {
  questions: InvestigationOpenQuestion[];
  factResolution: FactResolution | null | undefined;
  sources: EvidenceSource[];
}): InvestigationOpenQuestion[] {
  return options.questions.map((question) => {
    if (question.context_notes.length > 0) return question;
    return {
      ...question,
      context_notes: fallbackContextNotesForQuestion({
        question: question.question,
        factResolution: options.factResolution,
        sources: options.sources,
      }),
    };
  });
}

/**
 * Reads a salvage-model map of question text to briefing notes.
 */
export function parseSalvagedQuestionContextNotes(value: unknown): Map<string, OpenQuestionContextNote[]> {
  const map = new Map<string, OpenQuestionContextNote[]>();
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (value as { questions?: unknown }).questions
      : null;
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const question = normalizeWhitespace(String((row as { question?: unknown }).question ?? ""));
    const notes = parseOpenQuestionContextNotes((row as { context_notes?: unknown }).context_notes);
    if (!question || notes.length === 0) continue;
    map.set(question, notes);
    map.set(question.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim(), notes);
  }
  return map;
}
