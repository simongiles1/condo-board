/**
 * Person-anchored mention highlighting for contact evidence.
 *
 * Title/phone/email substrings are only marked when they sit near this
 * person's name in the same email body — not every "Condominium Manager"
 * belonging to someone else.
 */

import type {
  ContactHighlightSpan,
  ContactHighlightType,
} from "@/lib/email-analysis/contact-highlight-shared";

export type PersonNameParts = {
  firstName?: string | null;
  lastName?: string | null;
};

export type TextRange = { start: number; end: number };

/** Default max gap (chars) between a mention and a name anchor (same block). */
export const DEFAULT_PERSON_ANCHOR_PROXIMITY = 48;

function normalizeNeedle(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/** Prefer full name, then first+last separately (longer needles first). */
export function buildPersonNameNeedles(person: PersonNameParts): string[] {
  const first = normalizeNeedle(person.firstName);
  const last = normalizeNeedle(person.lastName);
  const needles: string[] = [];
  if (first && last) {
    needles.push(`${first} ${last}`);
    needles.push(`${last}, ${first}`);
  }
  if (last) needles.push(last);
  // Skip ultra-short firsts alone (e.g. "J.") — too many false positives.
  if (first && first.replace(/\./g, "").length >= 2) {
    needles.push(first);
  } else if (first && !last) {
    needles.push(first);
  }
  // Dedupe case-insensitively while keeping first (longest) spellings.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const needle of needles.sort((a, b) => b.length - a.length)) {
    const key = needle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(needle);
  }
  return out;
}

export function findSubstringRanges(
  text: string,
  needle: string,
): TextRange[] {
  const trimmed = needle.trim();
  if (!text || !trimmed) return [];
  const lower = text.toLowerCase();
  const needleLower = trimmed.toLowerCase();
  const ranges: TextRange[] = [];
  let from = 0;
  while (from < lower.length) {
    const idx = lower.indexOf(needleLower, from);
    if (idx < 0) break;
    ranges.push({ start: idx, end: idx + trimmed.length });
    from = idx + 1;
  }
  return ranges;
}

function rangesOverlapOrContain(a: TextRange, b: TextRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Collect non-overlapping name-anchor ranges in `text` for this person.
 * Longer matches win (e.g. "Haider Mukadam" over "Haider").
 */
export function findPersonNameAnchorRanges(
  text: string,
  person: PersonNameParts,
): TextRange[] {
  const needles = buildPersonNameNeedles(person);
  const candidates: TextRange[] = [];
  for (const needle of needles) {
    candidates.push(...findSubstringRanges(text, needle));
  }
  candidates.sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return a.start - b.start;
  });

  const taken: TextRange[] = [];
  for (const range of candidates) {
    if (taken.some((t) => rangesOverlapOrContain(t, range))) continue;
    taken.push(range);
  }
  return taken.sort((a, b) => a.start - b.start);
}

function lineBoundsAt(text: string, index: number): TextRange {
  let start = index;
  while (start > 0 && text[start - 1] !== "\n") start--;
  let end = index;
  while (end < text.length && text[end] !== "\n") end++;
  return { start, end };
}

function minDistance(a: TextRange, b: TextRange): number {
  if (a.end <= b.start) return b.start - a.end;
  if (b.end <= a.start) return a.start - b.end;
  return 0;
}

function rangeOnLine(range: TextRange, line: TextRange): boolean {
  return range.start >= line.start && range.start < line.end;
}

/** Rough "First Last" detector for competing owners on a title's line. */
const OTHER_FULL_NAME_RE = /\b[A-Z][a-z]{1,30}\s+[A-Z][a-z]{1,30}\b/g;

function lineHasOtherFullName(params: {
  lineText: string;
  person: PersonNameParts;
  mentionText: string;
}): boolean {
  const { lineText, person, mentionText } = params;
  const ourNeedles = new Set(
    buildPersonNameNeedles(person).map((n) => n.toLowerCase()),
  );
  const mentionLower = mentionText.trim().toLowerCase();
  OTHER_FULL_NAME_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OTHER_FULL_NAME_RE.exec(lineText)) != null) {
    const hit = match[0];
    const hitLower = hit.toLowerCase();
    if (ourNeedles.has(hitLower)) continue;
    // Don't treat the title phrase itself as a competing person name.
    if (mentionLower.includes(hitLower) || hitLower.includes(mentionLower)) {
      continue;
    }
    return true;
  }
  return false;
}

function previousNonEmptyLineBounds(
  text: string,
  line: TextRange,
): TextRange | null {
  let cursor = line.start - 1;
  while (cursor >= 0 && text[cursor] === "\n") cursor--;
  if (cursor < 0) return null;
  return lineBoundsAt(text, cursor);
}

/**
 * True when a title/phone/email mention belongs to this person.
 *
 * Priority:
 * 1) Our name shares the mention's line
 * 2) Signature-style: previous non-empty line has our name, and this line
 *    does not introduce another "First Last"
 * 3) Short char proximity on the same line only (comma-separated role)
 */
export function isMentionAnchoredToPerson(params: {
  text: string;
  mention: TextRange;
  nameAnchors: TextRange[];
  person: PersonNameParts;
  mentionText: string;
  proximityChars?: number;
}): boolean {
  const { text, mention, nameAnchors, person, mentionText } = params;
  if (nameAnchors.length === 0) return false;

  const line = lineBoundsAt(text, mention.start);
  const ourOnLine = nameAnchors.filter((a) => rangeOnLine(a, line));
  if (ourOnLine.length > 0) return true;

  const lineText = text.slice(line.start, line.end);
  if (lineHasOtherFullName({ lineText, person, mentionText })) {
    return false;
  }

  const prev = previousNonEmptyLineBounds(text, line);
  if (prev && nameAnchors.some((a) => rangeOnLine(a, prev))) {
    return true;
  }

  // Same-line comma roles without requiring the name detector above:
  // only when a name anchor is already on this line (handled), or the gap
  // to the nearest name is tiny and does not cross a newline.
  const proximity = params.proximityChars ?? DEFAULT_PERSON_ANCHOR_PROXIMITY;
  for (const anchor of nameAnchors) {
    if (minDistance(mention, anchor) > proximity) continue;
    const betweenStart = Math.min(mention.end, anchor.end);
    const betweenEnd = Math.max(mention.start, anchor.start);
    const between = text.slice(betweenStart, betweenEnd);
    if (between.includes("\n")) continue;
    return true;
  }
  return false;
}

/**
 * Build offset spans for a mention string that is tied to this person.
 * Also marks the nearby name anchors as `contact_name` for context.
 */
export function buildPersonAnchoredMentionSpans(params: {
  text: string;
  person: PersonNameParts;
  mentionText: string;
  mentionType: ContactHighlightType;
  proximityChars?: number;
}): ContactHighlightSpan[] {
  const mention = params.mentionText.trim();
  if (!params.text || !mention) return [];

  const nameAnchors = findPersonNameAnchorRanges(params.text, params.person);
  if (nameAnchors.length === 0) return [];

  const mentionRanges = findSubstringRanges(params.text, mention).filter(
    (range) =>
      isMentionAnchoredToPerson({
        text: params.text,
        mention: range,
        nameAnchors,
        person: params.person,
        mentionText: mention,
        proximityChars: params.proximityChars,
      }),
  );
  if (mentionRanges.length === 0) return [];

  const spans: ContactHighlightSpan[] = [];
  for (const range of mentionRanges) {
    spans.push({
      type: params.mentionType,
      text: params.text.slice(range.start, range.end),
      start: range.start,
      end: range.end,
    });
  }
  for (const anchor of nameAnchors) {
    // Only name anchors that helped justify at least one mention.
    const used = mentionRanges.some((mentionRange) =>
      isMentionAnchoredToPerson({
        text: params.text,
        mention: mentionRange,
        nameAnchors: [anchor],
        person: params.person,
        mentionText: mention,
        proximityChars: params.proximityChars,
      }),
    );
    if (!used) continue;
    spans.push({
      type: "contact_name",
      text: params.text.slice(anchor.start, anchor.end),
      start: anchor.start,
      end: anchor.end,
    });
  }
  return spans;
}

export function textHasPersonAnchoredMention(params: {
  text: string;
  person: PersonNameParts;
  mentionText: string;
  proximityChars?: number;
}): boolean {
  return (
    buildPersonAnchoredMentionSpans({
      ...params,
      mentionType: "job_title",
    }).filter((s) => s.type !== "contact_name").length > 0
  );
}

/**
 * Offset spans for one email body in the evidence panel.
 * With a name: only mentions near that person. Without: every substring hit.
 */
export function buildEvidenceHighlightSpans(params: {
  text: string;
  person: PersonNameParts;
  mentionText: string;
  mentionType: ContactHighlightType;
}): ContactHighlightSpan[] {
  const hasName = Boolean(
    params.person.firstName?.trim() || params.person.lastName?.trim(),
  );
  if (hasName) {
    return buildPersonAnchoredMentionSpans(params);
  }
  const needle = params.mentionText.trim();
  if (!needle || !params.text) return [];
  const spans: ContactHighlightSpan[] = [];
  for (const range of findSubstringRanges(params.text, needle)) {
    spans.push({
      type: params.mentionType,
      text: params.text.slice(range.start, range.end),
      start: range.start,
      end: range.end,
    });
  }
  return spans;
}
