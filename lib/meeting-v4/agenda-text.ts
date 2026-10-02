/**
 * Agenda text sent with one V4 item.
 * Uses the same page rewrites and Docling pages as the V3 package comparison modal.
 */

import { readAgendaSourcePages } from "@/lib/meeting-v3/agenda-pages";
import {
  compareAgendaItemCodes,
  parentAgendaItemCode,
} from "@/lib/meeting-v2/agenda-outline";

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

function titleMatches(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function scorePageList(
  pages: readonly number[],
  correctedPages: ReadonlyMap<number, string>,
): number {
  let score = 0;
  for (const page of pages) {
    const corrected = correctedPages.get(page)?.trim() ?? "";
    if (corrected) score += 100;
    else if (correctedPages.has(page)) score += 1;
  }
  return score;
}

function pickBestPageList(
  candidates: readonly (readonly number[])[],
  correctedPages: ReadonlyMap<number, string>,
): number[] {
  let best: number[] = [];
  let bestScore = -1;
  for (const pages of candidates) {
    if (pages.length === 0) continue;
    const score = scorePageList(pages, correctedPages);
    if (score > bestScore || (score === bestScore && pages.length < best.length)) {
      bestScore = score;
      best = [...pages];
    }
  }
  return [...new Set(best.filter((page) => Number.isInteger(page) && page > 0))].sort(
    (left, right) => left - right,
  );
}

/**
 * Resolves package pages for a V2 agenda row.
 * Picks the V3 link whose pages have corrected rewrites when several rows match.
 */
export function resolveV3SourcePages(
  itemNumber: string,
  title: string,
  v3Rows: readonly V3AgendaPageLink[],
  v2Pages: readonly number[],
  correctedPages: ReadonlyMap<number, string>,
): number[] {
  const candidates: number[][] = [];

  for (const row of v3Rows) {
    if (compareAgendaItemCodes(itemNumber, row.itemNumber) === 0) {
      candidates.push(readAgendaSourcePages(row.sourcePagesJson));
    }
  }

  let code = itemNumber.trim();
  while (code.includes(".")) {
    const parent = parentAgendaItemCode(code);
    if (!parent) break;
    code = parent;
    for (const row of v3Rows) {
      if (compareAgendaItemCodes(code, row.itemNumber) === 0) {
        candidates.push(readAgendaSourcePages(row.sourcePagesJson));
      }
    }
  }

  if (title.trim()) {
    for (const row of v3Rows) {
      if (titleMatches(row.title, title)) {
        candidates.push(readAgendaSourcePages(row.sourcePagesJson));
      }
    }
  }

  const fromV2 = [...new Set(v2Pages.filter((page) => Number.isInteger(page) && page > 0))].sort(
    (left, right) => left - right,
  );
  if (fromV2.length > 0) candidates.push(fromV2);

  return pickBestPageList(candidates, correctedPages);
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
  correctedPages: ReadonlyMap<number, string>;
}): number[] {
  return resolveV3SourcePages(
    input.itemNumber,
    input.title,
    input.v3Rows,
    input.v2Pages,
    input.correctedPages,
  );
}

/** Corrected, Docling, and the text sent to the draft model. */
export type MeetingsV4AgendaExtracts = {
  /** Corrected rewrites for the linked pages; Docling only when a page has no rewrite. */
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
 * Builds corrected and Docling extracts for one item's linked pages.
 * The draft prompt receives the corrected extract; missing rewrites fall back to Docling per page.
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
  const sentFromPages = sentParts.join("\n\n");
  const sent =
    sentFromPages
    || (ordered.length === 0 ? input.fallback.trim() : "");

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
