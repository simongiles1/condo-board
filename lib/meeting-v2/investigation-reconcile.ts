/**
 * Post-investigation helpers: skip redundant wrap-up injection, rewrite
 * package notes the transcript contradicted, and keep guest outline items
 * from absorbing later PM-report resolutions.
 */

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
