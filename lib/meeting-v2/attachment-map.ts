import { groupPageRanges, liveAgendaOutlineRows } from "@/lib/meeting-v2/live-agenda";

/** Inclusive page range in the board-package PDF. */
export type AttachmentMapRange = {
  start: number;
  end: number;
};

/** One row in the review list, in the same order as the live-room agenda. */
export type AttachmentMapRow = {
  key: string;
  itemNumber: string;
  title: string;
  kind: "leaf" | "heading";
  agendaItemId: string | null;
  attachmentRanges: AttachmentMapRange[];
};

/** One painted block on the package minimap. */
export type AttachmentMapBand =
  | { kind: "agenda"; start: number; end: number }
  | { kind: "linked"; start: number; end: number; agendaItemId: string }
  | { kind: "gap"; start: number; end: number };

/** Agenda outline, attachment ranges, and PDF coverage for the review screen. */
export type AttachmentMap = {
  pageCount: number;
  agendaContentEndsAtPage: number;
  rows: AttachmentMapRow[];
  bands: AttachmentMapBand[];
  itemsWithoutAttachments: number;
  unlinkedAttachmentPages: number;
};

/**
 * Maps each agenda item to attachment pages and paints the package as contiguous bands.
 * Attachment pages are PDF pages after the agenda split. A page number inside the agenda
 * section does not count as an attachment. A gap band is an attachment page no item owns.
 * When two items list the same page, the earlier agenda row keeps it on the minimap.
 */
export function buildAttachmentMap(input: {
  items: Array<{
    id: string;
    itemNumber: string | null;
    title: string;
    sourcePages: number[];
    sectionLabel?: string | null;
  }>;
  agendaContentEndsAtPage: number;
  pageCount: number;
}): AttachmentMap {
  const pageCount = Math.max(0, Math.floor(input.pageCount));
  const split = Math.min(
    Math.max(0, Math.floor(input.agendaContentEndsAtPage)),
    pageCount,
  );
  const outline = liveAgendaOutlineRows(
    input.items.map((item) => ({
      id: item.id,
      itemNumber: item.itemNumber,
      title: item.title,
      sourceText: null,
      sourcePagesJson: JSON.stringify(item.sourcePages ?? []),
      sectionLabel: item.sectionLabel ?? null,
    })),
  );

  const attachmentPagesByItem = new Map<string, number[]>();
  for (const row of outline) {
    if (row.kind !== "leaf" || !row.agendaItemId) continue;
    const pages = [
      ...new Set(
        row.sourcePages.filter(
          (page) => Number.isInteger(page) && page > split && page <= pageCount,
        ),
      ),
    ].sort((left, right) => left - right);
    attachmentPagesByItem.set(row.agendaItemId, pages);
  }

  const rows: AttachmentMapRow[] = outline.map((row) => ({
    key: row.key,
    itemNumber: row.itemNumber,
    title: row.title,
    kind: row.kind,
    agendaItemId: row.agendaItemId,
    attachmentRanges:
      row.kind === "leaf" && row.agendaItemId
        ? groupPageRanges(attachmentPagesByItem.get(row.agendaItemId) ?? [])
        : [],
  }));

  const ownerByPage = new Map<number, string>();
  for (const row of rows) {
    if (row.kind !== "leaf" || !row.agendaItemId) continue;
    for (const page of attachmentPagesByItem.get(row.agendaItemId) ?? []) {
      if (!ownerByPage.has(page)) ownerByPage.set(page, row.agendaItemId);
    }
  }

  const bands: AttachmentMapBand[] = [];
  if (split >= 1) bands.push({ kind: "agenda", start: 1, end: split });

  let cursor = split + 1;
  while (cursor <= pageCount) {
    const owner = ownerByPage.get(cursor) ?? null;
    let end = cursor;
    while (end + 1 <= pageCount && (ownerByPage.get(end + 1) ?? null) === owner) end += 1;
    if (owner) {
      bands.push({ kind: "linked", start: cursor, end, agendaItemId: owner });
    } else {
      bands.push({ kind: "gap", start: cursor, end });
    }
    cursor = end + 1;
  }

  const itemsWithoutAttachments = rows.filter(
    (row) => row.kind === "leaf" && row.attachmentRanges.length === 0,
  ).length;
  const unlinkedAttachmentPages = bands.reduce(
    (total, band) => (band.kind === "gap" ? total + band.end - band.start + 1 : total),
    0,
  );

  return {
    pageCount,
    agendaContentEndsAtPage: split,
    rows,
    bands,
    itemsWithoutAttachments,
    unlinkedAttachmentPages,
  };
}

/** One attachment page for the thumbnail grid. Agenda-section pages are omitted. */
export type AttachmentPageCard = {
  page: number;
  agendaItemId: string | null;
};

/**
 * Expands coverage bands into one card per attachment page, in page order.
 * A null agenda item means that page is not linked.
 */
export function attachmentPageCards(bands: AttachmentMapBand[]): AttachmentPageCard[] {
  const cards: AttachmentPageCard[] = [];
  for (const band of bands) {
    if (band.kind === "agenda") continue;
    for (let page = band.start; page <= band.end; page += 1) {
      cards.push({
        page,
        agendaItemId: band.kind === "linked" ? band.agendaItemId : null,
      });
    }
  }
  return cards;
}
