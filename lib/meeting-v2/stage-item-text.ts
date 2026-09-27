/**
 * Keeps one agenda item's section of a shared package page.
 * A later item's heading on the same page is the cut.
 */

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * Heading or title with the outline number and punctuation removed.
 */
export function normalizeAgendaHeading(value: string): string {
  return value
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:\d+(?:\.\d+)*|[A-Za-z])\.?\s+/, "")
    .replace(/&amp;/g, "&")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function headingsMatch(heading: string, title: string): boolean {
  const left = normalizeAgendaHeading(heading);
  const right = normalizeAgendaHeading(title);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 16 && longer.startsWith(shorter);
}

/**
 * Text from this item's heading up to the next agenda item on the same page.
 * Returns the original text when this item's heading is not in the page.
 */
export function clipStageTextToItem(text: string, title: string, otherTitles: string[]): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return text;
  const lines = text.split("\n");
  const headingIndexes = lines.flatMap((line, index) => (HEADING.test(line) ? [index] : []));
  const start = headingIndexes.find((index) => headingsMatch(lines[index] ?? "", trimmedTitle));
  if (start == null) return text;
  const end = headingIndexes.find(
    (index) => index > start && otherTitles.some((other) => headingsMatch(lines[index] ?? "", other)),
  );
  return lines.slice(start, end ?? lines.length).join("\n").trim();
}
