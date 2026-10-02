/**
 * Agenda text sent with one V4 item.
 * Corrected page markdown is the printed package. Docling is the raw extract for review.
 */

import { readAgendaSourcePages } from "@/lib/meeting-v3/agenda-pages";
import { parentAgendaItemCode } from "@/lib/meeting-v2/agenda-outline";

/** One V3 agenda row used to resolve linked package pages for a V2 item. */
export type V3AgendaPageLink = {
  itemNumber: string;
  title: string;
  sourcePagesJson: string;
};

/** Normalizes an agenda code for lookup across V2 and V3 rows. */
export function agendaItemNumberKey(itemNumber: string): string {
  return itemNumber.trim().replace(/\s+/g, " ");
}

/**
 * Builds a map of V3-linked source pages keyed by item number.
 * V4 segmentation uses V2 ids; V3 attachment linking holds the authoritative page list.
 */
export function v3SourcePagesByItemNumber(
  rows: ReadonlyArray<{ itemNumber: string; sourcePagesJson: string }>,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const pages = readAgendaSourcePages(row.sourcePagesJson);
    if (pages.length === 0) continue;
    map.set(agendaItemNumberKey(row.itemNumber), pages);
  }
  return map;
}

function pagesForItemNumber(
  itemNumber: string,
  byNumber: ReadonlyMap<string, readonly number[]>,
): number[] | null {
  const pages = byNumber.get(agendaItemNumberKey(itemNumber));
  return pages && pages.length > 0 ? [...pages] : null;
}

/**
 * Resolves package pages for a V2 agenda row.
 * Matches V3 attachment links by item number, parent codes, title, then V2 pages.
 */
export function resolveV3SourcePages(
  itemNumber: string,
  title: string,
  v3Rows: readonly V3AgendaPageLink[],
  v2Pages: readonly number[],
): number[] {
  const byNumber = v3SourcePagesByItemNumber(v3Rows);

  const direct = pagesForItemNumber(itemNumber, byNumber);
  if (direct) return direct;

  let code = itemNumber.trim();
  while (code.includes(".")) {
    const parent = parentAgendaItemCode(code);
    if (!parent) break;
    code = parent;
    const linked = pagesForItemNumber(code, byNumber);
    if (linked) return linked;
  }

  const titleKey = title.trim().toLowerCase();
  if (titleKey) {
    for (const row of v3Rows) {
      const rowTitle = row.title.trim().toLowerCase();
      if (rowTitle === titleKey || rowTitle.includes(titleKey) || titleKey.includes(rowTitle)) {
        const linked = readAgendaSourcePages(row.sourcePagesJson);
        if (linked.length > 0) return linked;
      }
    }
  }

  const fromV2 = [...new Set(v2Pages.filter((page) => Number.isInteger(page) && page > 0))].sort(
    (left, right) => left - right,
  );
  return fromV2;
}

/**
 * Chooses source pages for one agenda row.
 * Prefer V3-linked pages when present; otherwise use the V2 row.
 */
export function resolveAgendaSourcePages(input: {
  itemNumber: string;
  title: string;
  v2Pages: readonly number[];
  v3Rows: readonly V3AgendaPageLink[];
}): number[] {
  return resolveV3SourcePages(input.itemNumber, input.title, input.v3Rows, input.v2Pages);
}

/** Corrected, Docling, and the combined text sent to the draft model. */
export type MeetingsV4AgendaExtracts = {
  sent: string;
  corrected: string;
  docling: string;
};

function joinPageText(
  pages: readonly number[],
  textByPage: ReadonlyMap<number, string>,
): string {
  const chunks = pages.flatMap((page) => {
    const text = textByPage.get(page)?.trim() ?? "";
    return text ? [`Page ${page}\n${text}`] : [];
  });
  return chunks.join("\n\n");
}

/**
 * Joins corrected page text for the item's source pages, in page order.
 * Builds Docling-only and corrected-first bundles for the draft prompt and UI.
 */
export function buildAgendaExtracts(input: {
  sourcePages: readonly number[];
  correctedPages: ReadonlyMap<number, string>;
  doclingPages: ReadonlyMap<number, string>;
  fallback: string;
}): MeetingsV4AgendaExtracts {
  const ordered = [...new Set(input.sourcePages)]
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((left, right) => left - right);

  const docling = joinPageText(ordered, input.doclingPages);
  const corrected = joinPageText(ordered, input.correctedPages);

  const sentParts = ordered.flatMap((page) => {
    const text = (input.correctedPages.get(page) ?? input.doclingPages.get(page))?.trim() ?? "";
    return text ? [`Page ${page}\n${text}`] : [];
  });
  const sent = sentParts.length > 0 ? sentParts.join("\n\n") : input.fallback.trim();

  return { sent, corrected, docling };
}

/**
 * @deprecated Use {@link buildAgendaExtracts}. Kept for tests that assert page-level behavior.
 */
export function agendaTextForItem(input: {
  sourcePages: readonly number[];
  pageText: ReadonlyMap<number, string>;
  fallback: string;
}): string {
  return buildAgendaExtracts({
    sourcePages: input.sourcePages,
    correctedPages: input.pageText,
    doclingPages: input.pageText,
    fallback: input.fallback,
  }).sent;
}
