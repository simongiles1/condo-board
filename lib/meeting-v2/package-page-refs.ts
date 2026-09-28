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
 * Visible PDF pages for a citation opened in the package viewer.
 * Multi-page citations use continuous scroll; navigation stays inside the span.
 */
export function packagePdfViewRange(input: {
  initialPage?: number;
  citedEnd?: number;
  storedPageCount: number;
}): {
  start: number;
  end: number;
  pageNumbers: number[];
  continuousScroll: boolean;
  openPage: number;
} {
  const storedPageCount = Math.max(0, input.storedPageCount);
  const requestedPage = Math.max(
    1,
    input.initialPage && input.initialPage > 0 ? input.initialPage : 1,
  );

  if (input.citedEnd == null) {
    const end = storedPageCount > 0 ? storedPageCount : requestedPage;
    return {
      start: 1,
      end,
      pageNumbers: [],
      continuousScroll: false,
      openPage: Math.min(requestedPage, end),
    };
  }

  const start = requestedPage;
  const citedEnd = Math.max(start, input.citedEnd);
  const end = storedPageCount > 0 ? Math.min(citedEnd, storedPageCount) : citedEnd;
  const clampedStart = Math.min(start, end);
  const pageNumbers = Array.from(
    { length: Math.max(0, end - clampedStart + 1) },
    (_, index) => clampedStart + index,
  );
  return {
    start: clampedStart,
    end,
    pageNumbers,
    continuousScroll: pageNumbers.length > 1,
    openPage: pageNumbers.includes(requestedPage) ? requestedPage : clampedStart,
  };
}

/**
 * Page ranges named in package text, such as `(Page …) 13 - 26` or `(Page 27)`.
 * The same shapes `linkPackagePageCitations` turns into links.
 */
export function packageCitationRanges(text: string): Array<{ start: number; end: number }> {
  const decoded = decodeExtractedText(text);
  const ranges: Array<{ start: number; end: number }> = [];
  const patterns = [
    /\(Page\b[^)\n]{0,80}\)\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?/gi,
    /\(\s*Pages?\s+(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\s*\)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      const start = Number(match[1]);
      const end = match[2] == null ? start : Number(match[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) continue;
      ranges.push({ start: Math.min(start, end), end: Math.max(start, end) });
    }
  }
  return ranges;
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
