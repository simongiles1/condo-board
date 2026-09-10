/**
 * Lexical attachment-filename matching for corpus search.
 *
 * Vector search embeds chunk_text only. Filenames live in metadata, so a query
 * that is (or contains) a file name will miss the document unless we look up
 * email_attachments.filename directly.
 */

const FILE_EXTENSION_RE =
  /[^\n?]+?\.(?:pdf|docx?|xlsx?|xlsm|csv|png|jpe?g|gif|webp|txt|md)\b/gi;

const QUESTION_FILLER_RE =
  /\b(?:where|what|which|who|when|how|is|are|was|were|the|a|an|please|find|locate|show|me|named|called)\b/gi;

const FILENAME_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "where",
  "what",
  "which",
  "who",
  "when",
  "how",
  "is",
  "are",
  "file",
  "named",
  "called",
  "attachment",
  "document",
  "find",
  "locate",
  "show",
]);

export const FILENAME_MATCH_SIMILARITY = 0.93;
/** Extra lexical needles (from query rewrite) must not outrank semantic email hits. */
export const FILENAME_ALIAS_SIMILARITY = 0.78;
export const MAX_FILENAME_ATTACHMENT_HITS = 40;
export const EMAIL_CONTEXT_EXCERPT_CHARS = 500;

export function isFileSeekingQuery(query: string): boolean {
  return /\b(find the file|file that has|which file|what file|attached file|the pdf|the document)\b/i.test(
    query,
  );
}

export function coveringEmailQueryOverlap(
  query: string,
  subject: string | null | undefined,
  body: string | null | undefined,
  extraNeedles: string[] = [],
): number {
  const hay = `${subject ?? ""} ${body ?? ""}`.toLowerCase();
  if (!hay.trim()) return 0;
  const tokens = [
    ...distinctiveTokens(query),
    ...extraNeedles.map((needle) => needle.toLowerCase()).filter((needle) => needle.length >= 3),
  ];
  const seen = new Set<string>();
  let hits = 0;
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (hay.includes(token)) hits += 1;
  }
  return hits;
}

export function filenameMatchesAlias(
  filename: string,
  extraNeedles: string[],
): boolean {
  if (extraNeedles.length === 0) return false;
  const haystack = ` ${filename.toLowerCase()} `;
  for (const needle of extraNeedles) {
    const token = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (token.length < 3) continue;
    const re = new RegExp(`[^a-z0-9]${token}[^a-z0-9]`, "i");
    if (re.test(haystack)) return true;
  }
  return false;
}

export function normalizeFilenameHaystack(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, " ").trim();
}

export function stripQuestionFiller(query: string): string {
  return query
    .replace(QUESTION_FILLER_RE, " ")
    .replace(/[?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFileLikeNames(query: string): string[] {
  const haystack = stripQuestionFiller(query) || query;
  const matches = haystack.match(FILE_EXTENSION_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of matches) {
    const normalized = match.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function distinctiveTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/g)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter(
      (token) =>
        token.length >= 4 &&
        !FILENAME_STOPWORDS.has(token) &&
        token !== "pdf" &&
        token !== "docx",
    );
}

/**
 * LIKE needles for email_attachments.filename. Empty means skip lexical lookup
 * (the query is a prose question with no file-like signal).
 */
export function filenameSearchNeedles(
  query: string,
  extraNeedles: string[] = [],
): string[] {
  const trimmed = query.trim();
  if (!trimmed && extraNeedles.length === 0) return [];

  const needles: string[] = [];
  const seen = new Set<string>();

  function addNeedle(raw: string, minLen = 4) {
    const cleaned = raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length < minLen) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    needles.push(cleaned);
  }

  for (const name of extractFileLikeNames(trimmed)) {
    addNeedle(name);
  }

  const stripped = stripQuestionFiller(trimmed);
  const hasDigit = /\d/.test(stripped);
  const tokens = distinctiveTokens(stripped);
  const digitTokens = tokens.filter((token) => /\d/.test(token));

  for (const token of digitTokens) {
    addNeedle(token);
  }

  if (
    stripped.length >= 10 &&
    (hasDigit || extractFileLikeNames(trimmed).length > 0 || tokens.length >= 3)
  ) {
    addNeedle(stripped);
  }

  for (const extra of extraNeedles) {
    addNeedle(extra, 3);
  }

  return needles;
}

export function filenameMatchesQuery(filename: string, query: string): boolean {
  const haystack = normalizeFilenameHaystack(filename);
  if (!haystack) return false;

  const fileLikes = extractFileLikeNames(query);
  if (fileLikes.length > 0) {
    return fileLikes.some((name) => {
      const needle = normalizeFilenameHaystack(name);
      if (needle.length < 8) return false;
      return haystack.includes(needle) || needle.includes(haystack);
    });
  }

  const stripped = stripQuestionFiller(query);
  const strippedNorm = normalizeFilenameHaystack(stripped);
  if (strippedNorm.length >= 8 && haystack.includes(strippedNorm)) return true;
  if (strippedNorm.length >= 8 && strippedNorm.includes(haystack)) return true;

  const queryTokens = distinctiveTokens(stripped);
  if (queryTokens.length === 0) return false;
  const filenameTokens = new Set(distinctiveTokens(filename));
  const overlap = queryTokens.filter((token) => filenameTokens.has(token));
  const queryDigits = queryTokens.filter((token) => /\d/.test(token));
  const digitOverlap = overlap.filter((token) => /\d/.test(token));
  if (queryDigits.length > 0) {
    return digitOverlap.length === queryDigits.length && overlap.length >= 2;
  }
  return overlap.length >= Math.min(3, queryTokens.length);
}
