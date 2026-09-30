/**
 * Second pass over a Docling page: markdown in the same style, cells taken from the PDF.
 */

/**
 * Instructions for the page rewrite. The attached page wins over the Docling extract.
 */
export const PAGE_REWRITE_SYSTEM_PROMPT = `You rewrite one page of a condominium board package as markdown.

The attached PDF is the page. A prior Docling extraction of that page is included. Docling keeps the page's headings, prose, and tables, but it often places a table cell in the wrong column.

Write the page again in that same markdown style. The attached page decides the content and which column each cell belongs in.

Rules:
- Keep every fact printed on the page: dollar amounts, lead times, delivery in weeks or months, percentages, equipment names, vendor names, and the sentences around the tables.
- Do not drop a cell because it is not a dollar amount.
- Do not turn the page into a list of bids.
- When the extraction and the page disagree, follow the page.
- Do not invent a vendor, amount, duration, or percentage that is not printed.
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
