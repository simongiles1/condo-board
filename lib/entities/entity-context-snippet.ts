/** Compose and expand entity review context snippets from stored text and email bodies. */

const DEFAULT_MAX_LINK_CONTEXT_CHARS = 900;
const PASSAGE_RADIUS_CHARS = 320;
const MAX_PASSAGES = 3;

function normalizeSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isSubstringOfAny(text: string, others: string[]): boolean {
  const lower = text.toLowerCase();
  return others.some(
    (other) => other !== text && other.toLowerCase().includes(lower),
  );
}

/** Merge unique context snippets, preferring longer informative excerpts. */
export function composeLinkContext(
  contexts: Array<string | null | undefined>,
  options?: {
    maxLength?: number;
    /** Always include these snippets even when the max passage count is reached. */
    pinned?: Array<string | null | undefined>;
  },
): string | undefined {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LINK_CONTEXT_CHARS;
  const pinned = (options?.pinned ?? [])
    .map((context) => normalizeSnippet(context ?? ""))
    .filter(Boolean);

  const unique = new Map<string, string>();

  for (const raw of contexts) {
    const normalized = normalizeSnippet(raw ?? "");
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    const existing = unique.get(key);
    if (!existing || normalized.length > existing.length) {
      unique.set(key, normalized);
    }
  }

  let snippets = [...unique.values()].sort((a, b) => b.length - a.length);
  snippets = snippets.filter(
    (snippet) =>
      !pinned.some((required) => required.toLowerCase() === snippet.toLowerCase()) &&
      !isSubstringOfAny(snippet, snippets),
  );

  const selected: string[] = [];
  let totalLength = 0;

  for (const snippet of pinned) {
    selected.push(snippet);
    totalLength += snippet.length;
  }

  for (const snippet of snippets.slice(0, MAX_PASSAGES)) {
    const separator = selected.length > 0 ? 2 : 0;
    if (totalLength + separator + snippet.length > maxLength) {
      const remaining = maxLength - totalLength - separator;
      if (remaining > 80) {
        selected.push(`${snippet.slice(0, remaining - 1)}…`);
      }
      break;
    }
    selected.push(snippet);
    totalLength += separator + snippet.length;
  }

  if (selected.length === 0) return undefined;
  return selected.join("\n\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTermIndex(text: string, term: string): number {
  const trimmed = term.trim();
  if (!trimmed) return -1;

  if (trimmed.length <= 4) {
    const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "i");
    const match = pattern.exec(text);
    return match?.index ?? -1;
  }

  return text.toLowerCase().indexOf(trimmed.toLowerCase());
}

function expandToPassageBounds(
  text: string,
  matchIndex: number,
  matchLength: number,
): string {
  const minStart = Math.max(0, matchIndex - PASSAGE_RADIUS_CHARS);
  const maxEnd = Math.min(text.length, matchIndex + matchLength + PASSAGE_RADIUS_CHARS);

  let start = matchIndex;
  while (start > minStart) {
    const slice = text.slice(Math.max(minStart, start - 4), start);
    if (slice.endsWith("\n\n") || slice.endsWith(". ") || slice.endsWith(".\n")) {
      break;
    }
    start -= 1;
  }
  start = Math.max(minStart, start);

  let end = matchIndex + matchLength;
  while (end < maxEnd) {
    const slice = text.slice(end, Math.min(maxEnd, end + 4));
    if (slice.startsWith("\n\n") || slice.startsWith(". ") || slice.startsWith(".\n")) {
      end += slice.startsWith("\n\n") ? 2 : 2;
      break;
    }
    end += 1;
  }
  end = Math.min(maxEnd, end);

  let passage = normalizeSnippet(text.slice(start, end));
  if (start > 0) passage = `…${passage}`;
  if (end < text.length) passage = `${passage}…`;
  return passage;
}

/** Pull a readable paragraph around the first mention of a search term. */
export function extractPassageAroundTerm(
  text: string,
  term: string,
): string | undefined {
  const body = text.trim();
  if (!body || !term.trim()) return undefined;

  const index = findTermIndex(body, term);
  if (index < 0) return undefined;

  return expandToPassageBounds(body, index, term.trim().length);
}

export function collectEntitySearchTerms(input: {
  personName?: string | null;
  orgName?: string | null;
  linkedOrgName?: string | null;
  storedContexts?: string[];
}): string[] {
  const terms = new Set<string>();

  for (const value of [input.personName, input.orgName, input.linkedOrgName]) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    terms.add(trimmed);
  }

  for (const context of input.storedContexts ?? []) {
    for (const keyword of extractTopicKeywordsFromContext(context)) {
      terms.add(keyword);
    }
  }

  return [...terms].sort((a, b) => b.length - a.length);
}

const CONTEXT_STOPWORDS = new Set([
  "about",
  "after",
  "been",
  "from",
  "have",
  "that",
  "this",
  "will",
  "with",
  "would",
  "their",
  "there",
  "were",
  "when",
  "where",
  "which",
  "while",
  "provided",
  "awarded",
  "project",
  "company",
]);

/** Pull searchable topic terms from a short AI context line. */
export function extractTopicKeywordsFromContext(context: string): string[] {
  const keywords = new Set<string>();
  const normalized = context.trim();
  if (!normalized) return [];

  const phrases = normalized.match(
    /\b(?:performance bond|payment bond|labour(?: &| and) material(?: payment)? bond|surety bond)\b/gi,
  );
  for (const phrase of phrases ?? []) {
    keywords.add(phrase.trim());
  }

  for (const word of normalized.match(/\b[a-z]{4,}\b/gi) ?? []) {
    const lower = word.toLowerCase();
    if (!CONTEXT_STOPWORDS.has(lower)) {
      keywords.add(word);
    }
  }

  return [...keywords];
}

export function extractPassagesFromCorpus(
  corpus: string,
  searchTerms: string[],
): string[] {
  if (!corpus.trim() || searchTerms.length === 0) return [];

  const passages: string[] = [];
  for (const term of searchTerms) {
    const passage = extractPassageAroundTerm(corpus, term);
    if (passage) passages.push(passage);
  }
  return passages;
}

export function extractPassagesFromThreadText(
  threadText: string,
  searchTerms: string[],
): string[] {
  return extractPassagesFromCorpus(threadText, searchTerms);
}
