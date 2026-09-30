/**
 * Chooses the corrected pages that build a V3 agenda.
 * Attachment pages after the agenda split are left out. A missing correction is an error.
 */

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
