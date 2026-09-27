/**
 * Turns board-package page citations in extracted text into markdown links.
 * A link href is `#pkg/13` or `#pkg/13-26`.
 */

const ENTITY: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * Decodes the entities Docling leaves in extracted package text.
 */
export function decodeExtractedText(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITY[entity] ?? entity);
}

function pageLink(start: number, end: number | null): string {
  const from = end != null && end < start ? end : start;
  const to = end != null && end < start ? start : end;
  const label = to != null && to !== from ? `Pages ${from}–${to}` : `Page ${from}`;
  const href = to != null && to !== from ? `#pkg/${from}-${to}` : `#pkg/${from}`;
  return `[${label}](${href})`;
}

/**
 * Replaces package page citations with markdown links.
 * Covers a Docling page icon such as `(Page ... ... ...) 13 - 26` and `(Page 27)`.
 */
export function linkPackagePageCitations(text: string): string {
  const decoded = decodeExtractedText(text);
  const iconThenNumber =
    /\(Page\b[^)\n]{0,80}\)\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?/gi;
  const numberInside =
    /\(\s*Pages?\s+(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\s*\)/gi;
  return decoded
    .replace(iconThenNumber, (_match, start: string, end?: string) =>
      pageLink(Number(start), end == null ? null : Number(end)),
    )
    .replace(numberInside, (_match, start: string, end?: string) =>
      pageLink(Number(start), end == null ? null : Number(end)),
    );
}

/**
 * Explains a citation that runs past the pages kept for this meeting.
 * Returns null when the stored package includes the whole citation.
 */
export function storedPackageCitationGap(input: {
  citedStart: number;
  citedEnd: number;
  storedPageCount: number;
}): string | null {
  const { citedStart, citedEnd, storedPageCount } = input;
  if (storedPageCount < 1 || citedEnd <= storedPageCount) return null;
  if (citedStart > storedPageCount) {
    const pageLabel = citedStart === citedEnd ? `Page ${citedStart}` : `Pages ${citedStart}–${citedEnd}`;
    return `${pageLabel} is not in this meeting's package. Only ${storedPageCount} pages were kept when the meeting was created.`;
  }
  return `This citation runs through page ${citedEnd}. This meeting's package has ${storedPageCount} pages, so pages ${storedPageCount + 1}–${citedEnd} are missing.`;
}

/**
 * Reads a `#pkg/13` or `#pkg/13-26` href. Returns null for any other link.
 */
export function packagePageFromHref(href: string): { start: number; end: number } | null {
  const match = href.match(/^#pkg\/(\d{1,4})(?:-(\d{1,4}))?$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] == null ? start : Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
