/** Parse inclusive 1-based ranges like "1-20, 25, 30-32". */
export function parsePageRangeInput(
  input: string,
  maxPage: number,
): { pages: number[]; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { pages: [], error: "Enter a page range." };
  }

  const pages = new Set<number>();
  const parts = trimmed.split(/[,;\s]+/).filter(Boolean);

  for (const part of parts) {
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < 1 || end < 1 || start > end) {
        return { pages: [], error: `Invalid range "${part}".` };
      }
      if (end > maxPage) {
        return {
          pages: [],
          error: `Range "${part}" exceeds document length (${maxPage} pages).`,
        };
      }
      for (let n = start; n <= end; n += 1) {
        pages.add(n);
      }
      continue;
    }

    const single = Number(part);
    if (!Number.isInteger(single) || single < 1) {
      return { pages: [], error: `Invalid page "${part}".` };
    }
    if (single > maxPage) {
      return {
        pages: [],
        error: `Page ${single} exceeds document length (${maxPage} pages).`,
      };
    }
    pages.add(single);
  }

  return {
    pages: [...pages].sort((a, b) => a - b),
    error: null,
  };
}

/**
 * Inclusive ranges of pages from 1 through `pageCount` that are not selected.
 */
export function omittedPageRanges(
  pageCount: number,
  selectedPages: number[],
): Array<{ start: number; end: number }> {
  const selected = new Set(selectedPages);
  const ranges: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  for (let page = 1; page <= pageCount; page += 1) {
    if (!selected.has(page)) {
      if (start == null) start = page;
      continue;
    }
    if (start != null) {
      ranges.push({ start, end: page - 1 });
      start = null;
    }
  }
  if (start != null) ranges.push({ start, end: pageCount });
  return ranges;
}

/**
 * Readable list of omitted ranges, such as "14–26, 40".
 */
export function formatOmittedPageRanges(
  ranges: Array<{ start: number; end: number }>,
): string {
  return ranges
    .map((range) => (range.start === range.end ? String(range.start) : `${range.start}–${range.end}`))
    .join(", ");
}

/**
 * Default last agenda page for an upcoming meeting.
 * Page 12 when that page is selected and is not the last page. Otherwise the second-to-last selected page.
 */
export function defaultAgendaBoundaryPage(selectedPages: number[]): number | null {
  const pages = [...new Set(selectedPages)]
    .filter((page) => Number.isInteger(page) && page >= 1)
    .sort((left, right) => left - right);
  if (pages.length < 2) return null;
  const last = pages[pages.length - 1];
  if (pages.includes(12) && 12 < last) return 12;
  return pages[pages.length - 2];
}

export function formatPageList(pages: number[]): string {
  if (pages.length === 0) return "none";
  if (pages.length <= 8) return pages.join(", ");

  const sorted = [...pages].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return `${first}–${last} (${pages.length} pages)`;
}
