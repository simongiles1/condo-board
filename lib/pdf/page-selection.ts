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

export function formatPageList(pages: number[]): string {
  if (pages.length === 0) return "none";
  if (pages.length <= 8) return pages.join(", ");

  const sorted = [...pages].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return `${first}–${last} (${pages.length} pages)`;
}
