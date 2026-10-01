/**
 * Chooses the corrected pages that build a V3 agenda.
 * Attachment pages after the agenda split are left out. A missing correction is an error.
 */

/**
 * Stored pages that belong to the agenda side of the crossover.
 * When no split is recorded, every stored page is treated as agenda.
 */
export function countAgendaPages(
  pageCount: number,
  agendaContentEndsAtPage: number | null,
): number {
  if (pageCount <= 0) return 0;
  if (agendaContentEndsAtPage == null) return pageCount;
  return Math.min(agendaContentEndsAtPage, pageCount);
}

/**
 * True when a stored page should receive the Gemini correction pass.
 */
export function isAgendaPageForCorrection(
  pageNumber: number,
  agendaContentEndsAtPage: number | null,
): boolean {
  if (agendaContentEndsAtPage == null) return true;
  return pageNumber <= agendaContentEndsAtPage;
}

/**
 * True when extracted text puts more than one dollar amount on the same line.
 * Those attachment pages need the PDF correction pass so a fee stays on its row.
 */
export function pageNeedsTableCorrection(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.split(/\n/).some((line) => (line.match(/\$\s?\d/g) ?? []).length >= 2);
}

/** One page the agenda extractor can read. */
export type AgendaPageText = {
  pageNumber: number;
  heading: string | null;
  text: string;
};

/**
 * Corrected text for the agenda range.
 * Throws when the split leaves no pages, or an agenda page has no correction.
 */
export function selectCorrectedAgendaPages(input: {
  pages: Array<{ pageNumber: number; heading: string | null }>;
  rewrites: Array<{ pageNumber: number; correctedText: string }>;
  agendaContentEndsAtPage: number | null;
}): AgendaPageText[] {
  const split = input.agendaContentEndsAtPage;
  const selected = [...input.pages]
    .filter((page) => split == null || page.pageNumber <= split)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  if (selected.length === 0) {
    throw new Error("The agenda/attachment split left no agenda pages to extract.");
  }
  const byPage = new Map(
    input.rewrites.map((row) => [row.pageNumber, row.correctedText.trim()]),
  );
  return selected.map((page) => {
    const text = byPage.get(page.pageNumber);
    if (!text) {
      throw new Error(`Page ${page.pageNumber} has not been corrected yet.`);
    }
    return { pageNumber: page.pageNumber, heading: page.heading, text };
  });
}

/**
 * Page numbers stored on an agenda row.
 * Returns an empty list when the JSON is not an array of numbers.
 */
export function readAgendaSourcePages(json: string): number[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((page): page is number => Number.isInteger(page) && page > 0);
  } catch {
    return [];
  }
}

/**
 * Vendor names stored on an agenda row.
 * Returns an empty list when the JSON is missing or not an array of strings.
 */
export function readAgendaVendors(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  } catch {
    return [];
  }
}

/** Inclusive contiguous page ranges; gaps in the input start a new range. */
export function sourcePageContiguousRanges(
  pages: number[],
): Array<{ start: number; end: number }> {
  const sorted = [...new Set(pages.filter((page) => Number.isInteger(page) && page > 0))].sort(
    (left, right) => left - right,
  );
  if (sorted.length === 0) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  let start = sorted[0] ?? 0;
  let end = start;
  for (const page of sorted.slice(1)) {
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push({ start, end });
    start = page;
    end = page;
  }
  ranges.push({ start, end });
  return ranges;
}

/**
 * A short label for the page numbers stored on an agenda item.
 * A gap stays visible, so pages 4 and 13–14 are not printed as 4–14.
 * Returns null when the item has no pages.
 */
export function formatSourcePages(pages: number[]): string | null {
  const ranges = sourcePageContiguousRanges(pages);
  if (ranges.length === 0) return null;
  const body = ranges
    .map(({ start, end }) => (start === end ? String(start) : `${start}–${end}`))
    .join(", ");
  const pageCount = new Set(pages.filter((page) => Number.isInteger(page) && page > 0)).size;
  return pageCount === 1 ? `page ${body}` : `pages ${body}`;
}

/** Button label for one inclusive page range in the attachment linker. */
export function formatAttachmentPageRangeLabel(start: number, end: number): string {
  return start === end ? `Page ${start}` : `Pages ${start}–${end}`;
}
