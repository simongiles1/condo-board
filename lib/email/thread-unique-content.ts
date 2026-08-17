import { computeUniqueBodyText } from "@/lib/email/quote-strip";

export type ThreadMessageForDiff = {
  id: string;
  bodyText: string;
  bodyHtml?: string | null;
  receivedAt: string;
};

/** Collapse formatting noise so Outlook originals match Gmail forwards. */
export function heavyNormalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantNormalizedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => heavyNormalize(line))
    .filter((line) => line.length > 20);
}

function lineMatchesPrior(
  line: string,
  priorNormLines: Set<string>,
): boolean {
  const norm = heavyNormalize(line);
  if (norm.length <= 20) return false;
  if (priorNormLines.has(norm)) return true;
  for (const prior of priorNormLines) {
    if (prior.includes(norm) || norm.includes(prior)) return true;
  }
  return false;
}

/** Fraction of prior content words (len>4) found in haystack, after heavy normalize. */
export function contentOverlapRatio(prior: string, haystack: string): number {
  const p = heavyNormalize(prior);
  const h = heavyNormalize(haystack);
  if (!p || !h) return 0;
  if (h.includes(p) || p.includes(h)) return 1;

  const words = p.split(" ").filter((w) => w.length > 4);
  if (words.length === 0) return 0;
  let hits = 0;
  for (const word of words) {
    if (h.includes(word)) hits += 1;
  }
  return hits / words.length;
}

const FORWARD_BANNER = /-{2,}\s*Forwarded message\s*-{2,}/i;
const OVERLAP_THRESHOLD = 0.7;

/**
 * If a Gmail forward block largely restates a prior thread message, drop it.
 * Keeps only the authored intro above the banner (including signature).
 */
export function stripDuplicateForwardBlocks(
  text: string,
  priorBodies: string[],
): string {
  if (!priorBodies.length) return text;

  const match = FORWARD_BANNER.exec(text);
  if (!match || match.index == null) return text;

  const intro = text.slice(0, match.index).trimEnd();
  const forwardBlock = text.slice(match.index);

  for (const prior of priorBodies) {
    if (contentOverlapRatio(prior, forwardBlock) >= OVERLAP_THRESHOLD) {
      return intro;
    }
  }

  return text;
}

/** Drop leftover reply attribution when the quoted body was already removed. */
function cleanupOrphanAttributions(text: string): string {
  return text
    .replace(/\n*On .+ wrote:\s*$/i, "")
    .replace(/\n*Le .+ a[ée]crit\s*:\s*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanupEmptyForwardShell(text: string): string {
  return text
    .replace(/-{2,}\s*Forwarded message\s*-{2,}[\s\S]*$/i, (block) => {
      const withoutBanner = block
        .replace(/-{2,}\s*Forwarded message\s*-{2,}/i, "")
        .replace(/^\s*(From|Date|Subject|To):.*$/gim, "")
        .trim();
      return withoutBanner ? block : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removePriorFromText(current: string, prior: string): string {
  if (!prior.trim() || !current.trim()) return current;

  if (current.includes(prior)) {
    return current.replace(prior, "").trim();
  }

  const priorNorm = heavyNormalize(prior);
  const currentNorm = heavyNormalize(current);
  if (priorNorm && currentNorm.includes(priorNorm)) {
    const priorNormLines = new Set(significantNormalizedLines(prior));
    return current
      .split(/\r?\n/)
      .filter((line) => !lineMatchesPrior(line, priorNormLines))
      .join("\n")
      .trim();
  }

  const priorNormLines = new Set(significantNormalizedLines(prior));
  if (priorNormLines.size === 0) return current;

  return current
    .split(/\r?\n/)
    .filter((line) => !lineMatchesPrior(line, priorNormLines))
    .join("\n")
    .trim();
}

function priorStrippedBodies(
  priorMessages: ThreadMessageForDiff[],
): string[] {
  return priorMessages
    .map((m) => computeUniqueBodyText(m.bodyText, m.bodyHtml))
    .filter((body) => body.trim().length > 0);
}

/**
 * Strict unique content for UI highlight: reply-quote strip, duplicate-forward
 * strip, then remove text already present in prior messages (may drop a
 * repeated signature that was the only new text on an earlier send).
 */
export function diffAgainstPriorMessages(
  message: ThreadMessageForDiff,
  priorMessages: ThreadMessageForDiff[],
): string {
  const stripped = computeUniqueBodyText(message.bodyText, message.bodyHtml);
  if (!priorMessages.length) return stripped;

  const priorBodies = priorStrippedBodies(priorMessages);
  let unique = stripDuplicateForwardBlocks(stripped, priorBodies);
  for (const prior of priorBodies) {
    unique = removePriorFromText(unique, prior);
  }

  unique = cleanupOrphanAttributions(unique);
  unique = cleanupEmptyForwardShell(unique);
  return unique || stripped;
}

/**
 * Authored block for LLM extraction: reply-quote strip + duplicate-forward
 * strip only. Keeps the full top-of-message block every time (intro + signature)
 * so contact facts in footers are not lost after the first send.
 */
export function authoredAgainstPriorMessages(
  message: ThreadMessageForDiff,
  priorMessages: ThreadMessageForDiff[],
): string {
  const stripped = computeUniqueBodyText(message.bodyText, message.bodyHtml);
  if (!priorMessages.length) return stripped;

  const priorBodies = priorStrippedBodies(priorMessages);
  let authored = stripDuplicateForwardBlocks(stripped, priorBodies);
  authored = cleanupOrphanAttributions(authored);
  authored = cleanupEmptyForwardShell(authored);
  return authored || stripped;
}

export function computeThreadUniqueBodies(
  messages: ThreadMessageForDiff[],
): Map<string, string> {
  const sorted = [...messages].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt),
  );
  const result = new Map<string, string>();

  for (let i = 0; i < sorted.length; i++) {
    const prior = sorted.slice(0, i);
    result.set(sorted[i].id, diffAgainstPriorMessages(sorted[i], prior));
  }

  return result;
}

/** Per-message authored bodies for analysis / `bodyTextUnique` persistence. */
export function computeThreadAuthoredBodies(
  messages: ThreadMessageForDiff[],
): Map<string, string> {
  const sorted = [...messages].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt),
  );
  const result = new Map<string, string>();

  for (let i = 0; i < sorted.length; i++) {
    const prior = sorted.slice(0, i);
    result.set(sorted[i].id, authoredAgainstPriorMessages(sorted[i], prior));
  }

  return result;
}
