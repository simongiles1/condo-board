/**
 * Traced caption corrections. The original utterance is never rewritten.
 * Amounts and decision words are not suggested.
 */

const MONEY = /\$|\b\d[\d,]*(?:\.\d+)?\b|\b(?:dollars|cents)\b/i;
const DECISION =
  /\b(?:approv(?:e|ed|al)|ratif(?:y|ied)|second(?:ed)?|carried|motion|passed)\b/i;

export type VocabularyCorrectionProposal = {
  heardText: string;
  proposedText: string;
};

export type RecognitionCorrectionStatus = "proposed" | "accepted" | "rejected";

/**
 * Suggests vocabulary phrases that almost match a span of the original caption.
 * Returns proposals only. The original string is not modified.
 */
export function proposeVocabularyCorrections(
  text: string,
  phrases: string[],
): VocabularyCorrectionProposal[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const proposals: VocabularyCorrectionProposal[] = [];
  const used = new Set<string>();

  for (const phrase of phrases) {
    const phraseTokens = phrase.split(/\s+/).filter(Boolean);
    if (phraseTokens.length < 2 || tokens.length < phraseTokens.length) continue;
    for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
      const heardText = tokens.slice(index, index + phraseTokens.length).join(" ");
      const heardKey = heardText.toLocaleLowerCase();
      if (used.has(heardKey) || heardKey === phrase.toLocaleLowerCase()) continue;
      if (isProtectedSpan(heardText) || isProtectedSpan(phrase)) continue;
      const distance = editDistance(heardKey, phrase.toLocaleLowerCase());
      const limit = Math.max(2, Math.floor(phrase.length * 0.3));
      if (distance <= 0 || distance > limit) continue;
      proposals.push({ heardText, proposedText: phrase });
      used.add(heardKey);
      break;
    }
    if (proposals.length >= 3) break;
  }

  return proposals;
}

/**
 * The original caption stays the original caption after a correction is accepted.
 */
export function originalRecognitionText(originalText: string): string {
  return originalText;
}

function isProtectedSpan(value: string): boolean {
  return MONEY.test(value) || DECISION.test(value);
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let row = 0; row < rows; row += 1) grid[row]![0] = row;
  for (let col = 0; col < cols; col += 1) grid[0]![col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      grid[row]![col] = Math.min(
        grid[row - 1]![col]! + 1,
        grid[row]![col - 1]! + 1,
        grid[row - 1]![col - 1]! + cost,
      );
    }
  }
  return grid[left.length]![right.length]!;
}
