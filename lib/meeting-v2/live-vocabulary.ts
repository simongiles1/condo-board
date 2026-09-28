/**
 * Live-room phrase hints. Meeting titles stay for the whole meeting.
 * The active leaf adds names from its package text, and the previous leaf
 * keeps those names for a short time after Next. OKF is not a source.
 * Hints are not written over the original utterance.
 */

/** How long the previous leaf's names stay in the hint list after Next. */
export const LIVE_VOCABULARY_HANGOVER_MS = 45_000;

const MAX_TITLES = 40;
const MAX_ACTIVE_PHRASES = 20;
const MAX_HANGOVER_PHRASES = 15;

const MONEY = /\$|\b\d[\d,]*(?:\.\d+)?\b|\b(?:dollars|cents)\b/i;
const DECISION_ONLY =
  /^(?:approv(?:e|ed|al)|ratif(?:y|ied|ication)|second(?:ed)?|carried|motion|passed|yes|no)(?:\s+(?:approv(?:e|ed|al)|ratif(?:y|ied|ication)|second(?:ed)?|carried|motion|passed|yes|no))*$/i;

export type VocabularyLeaf = {
  id: string;
  title: string;
  sourceText: string | null;
};

export type VocabularyNavigation = {
  agendaItemId: string | null;
  unscheduled: boolean;
  mediaOffsetMs: number;
};

export type LiveVocabulary = {
  phrases: string[];
  activeLeafId: string | null;
  hangoverLeafId: string | null;
};

/**
 * Active leaf, and the previous leaf while it is still inside the hangover window.
 */
export function vocabularyFocus(input: {
  leaves: Array<{ id: string }>;
  navigation: VocabularyNavigation[];
  nowOffsetMs: number;
  hangoverMs?: number;
}): { activeLeafId: string | null; hangoverLeafId: string | null } {
  const hangoverMs = input.hangoverMs ?? LIVE_VOCABULARY_HANGOVER_MS;
  const leafIds = new Set(input.leaves.map((leaf) => leaf.id));
  let activeLeafId: string | null = input.leaves[0]?.id ?? null;
  let activeSinceMs = 0;
  let hangoverLeafId: string | null = null;

  for (const event of input.navigation) {
    if (event.unscheduled || !event.agendaItemId || !leafIds.has(event.agendaItemId)) continue;
    if (event.agendaItemId !== activeLeafId) {
      hangoverLeafId = activeLeafId;
      activeSinceMs = event.mediaOffsetMs;
    }
    activeLeafId = event.agendaItemId;
  }

  const withinHangover =
    hangoverLeafId != null &&
    hangoverLeafId !== activeLeafId &&
    input.nowOffsetMs - activeSinceMs <= hangoverMs;

  return {
    activeLeafId,
    hangoverLeafId: withinHangover ? hangoverLeafId : null,
  };
}

/**
 * Phrase list for the recognizer: every agenda title, plus names from the active
 * leaf, plus names from the previous leaf during hangover.
 */
export function liveVocabularyPhrases(input: {
  leaves: VocabularyLeaf[];
  activeLeafId: string | null;
  hangoverLeafId: string | null;
}): LiveVocabulary {
  const titles = uniquePhrases(
    input.leaves
      .map((leaf) => cleanPhrase(leaf.title))
      .filter((title): title is string => title != null),
  ).slice(0, MAX_TITLES);

  const active = input.leaves.find((leaf) => leaf.id === input.activeLeafId);
  const hangover = input.leaves.find((leaf) => leaf.id === input.hangoverLeafId);
  const activePhrases = bodyPhrases(active?.sourceText ?? null).slice(0, MAX_ACTIVE_PHRASES);
  const hangoverPhrases = bodyPhrases(hangover?.sourceText ?? null).slice(0, MAX_HANGOVER_PHRASES);

  return {
    phrases: uniquePhrases([...activePhrases, ...hangoverPhrases, ...titles]),
    activeLeafId: input.activeLeafId,
    hangoverLeafId: input.hangoverLeafId,
  };
}

function cleanPhrase(value: string): string | null {
  const phrase = value.replace(/\s+/g, " ").trim();
  if (phrase.length < 4 || phrase.length > 120) return null;
  if (MONEY.test(phrase) || DECISION_ONLY.test(phrase)) return null;
  return phrase;
}

function bodyPhrases(text: string | null): string[] {
  if (!text) return [];
  const found =
    text
      .slice(0, 4000)
      .match(/\b[A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){1,5}\b/g) ?? [];
  return uniquePhrases(
    found.map((phrase) => cleanPhrase(phrase)).filter((phrase): phrase is string => phrase != null),
  );
}

function uniquePhrases(phrases: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const phrase of phrases) {
    const key = phrase.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(phrase);
  }
  return unique;
}
