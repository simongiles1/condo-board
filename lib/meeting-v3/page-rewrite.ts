/**
 * Second pass over a Docling page: markdown in the same style, cells taken from the PDF.
 */

/**
 * Instructions for the page rewrite. The attached page wins over the Docling extract.
 */
export const PAGE_REWRITE_SYSTEM_PROMPT = `You rewrite one page of a condominium board package as markdown.

The attached PDF is the page. A prior extraction of that page is included. It keeps the page's headings, prose, and tables, but it often misplaces text. A table cell can land in the wrong column. A page number can be pulled out of a sentence and left after a run of dots.

Write the page again in that same markdown style. The attached page decides the wording and where each value sits. Do this for every kind of page, including bids, minutes, reference lists, and forms.

Rules:
- Keep every fact printed on the page: dollar amounts, lead times, delivery in weeks or months, percentages, equipment names, vendor names, page references, and the sentences around them.
- Put a page reference back in the sentence it belongs to. "on page ………) 174 - 175" becomes "on page 174 - 175" when that is what the page shows.
- Do not drop a cell because it is not a dollar amount.
- When the extraction and the page disagree, follow the page.
- Do not invent a vendor, amount, duration, percentage, or page number that is not printed.
- Return the rewritten page only. No commentary before or after it.`;

/**
 * The rewritten page, with a wrapping markdown fence removed.
 * Throws when the reply is empty or is a JSON object.
 */
export function readPageRewriteMarkdown(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  if (!text) {
    throw new Error("The page rewrite was empty.");
  }
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") {
        throw new Error("The page rewrite returned JSON instead of markdown.");
      }
    } catch (error) {
      if (error instanceof SyntaxError) return text;
      throw error;
    }
  }
  return text;
}
