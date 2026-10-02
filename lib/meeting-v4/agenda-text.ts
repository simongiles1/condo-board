/**
 * Agenda text sent with one V4 item.
 * Corrected page markdown is the printed package. Stored notes are the fallback.
 */

/**
 * Joins corrected page text for the item's source pages, in page order.
 * Returns the fallback when none of those pages have text.
 */
export function agendaTextForItem(input: {
  sourcePages: readonly number[];
  pageText: ReadonlyMap<number, string>;
  fallback: string;
}): string {
  const chunks = [...new Set(input.sourcePages)]
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((left, right) => left - right)
    .flatMap((page) => {
      const text = input.pageText.get(page)?.trim() ?? "";
      return text ? [`Page ${page}\n${text}`] : [];
    });
  if (chunks.length > 0) return chunks.join("\n\n");
  return input.fallback.trim();
}
