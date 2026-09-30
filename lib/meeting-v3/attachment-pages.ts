/**
 * Links board-package pages after the agenda split onto V3 agenda items.
 * Citations in the corrected agenda text claim a page before a model assignment does.
 */

import {
  applyAttachmentPageAssignments,
  citedAttachmentAssignments,
} from "@/lib/meeting-v2/upcoming-meeting";

/** One corrected page after the agenda split. */
export type AttachmentPageText = {
  pageNumber: number;
  heading: string | null;
  text: string;
};

/**
 * Corrected text for pages after the agenda split.
 * Returns an empty list when the meeting has no split.
 * Throws when an attachment page has no correction.
 */
export function selectCorrectedAttachmentPages(input: {
  pages: Array<{ pageNumber: number; heading: string | null }>;
  rewrites: Array<{ pageNumber: number; correctedText: string }>;
  agendaContentEndsAtPage: number | null;
}): AttachmentPageText[] {
  const split = input.agendaContentEndsAtPage;
  if (split == null) return [];
  const selected = [...input.pages]
    .filter((page) => page.pageNumber > split)
    .sort((left, right) => left.pageNumber - right.pageNumber);
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
 * Puts attachment pages on agenda items.
 * Agenda-body pages stay. A cited page is not given to a later model assignment.
 * Returns the previous source pages unchanged when there is no split.
 */
export function linkCorrectedAttachmentPages(input: {
  agendaContentEndsAtPage: number | null;
  items: Array<{ id: string; sourcePages: number[]; citationText: string }>;
  attachmentPageNumbers: number[];
  modelAssignments: Array<{ agendaItemId: string; pages: number[] }>;
}): {
  pagesByItemId: Map<string, number[]>;
  unassignedPages: number[];
  assignedPageCount: number;
} {
  const split = input.agendaContentEndsAtPage;
  const attachmentPageNumbers = split == null
    ? []
    : input.attachmentPageNumbers.filter((page) => Number.isInteger(page) && page > split);
  if (split == null || attachmentPageNumbers.length === 0) {
    return {
      pagesByItemId: new Map(
        input.items.map((item) => [item.id, uniqueSorted(item.sourcePages)]),
      ),
      unassignedPages: [],
      assignedPageCount: 0,
    };
  }

  const citations = citedAttachmentAssignments({
    leaves: input.items.map((item) => ({ id: item.id, text: item.citationText })),
    attachmentPageNumbers,
  });
  const applied = applyAttachmentPageAssignments({
    leaves: input.items.map((item) => ({ id: item.id, sourcePages: item.sourcePages })),
    agendaContentEndsAtPage: split,
    attachmentPageNumbers,
    assignments: [...citations, ...input.modelAssignments],
  });
  return {
    pagesByItemId: applied.pagesByLeafId,
    unassignedPages: applied.unassignedPages,
    assignedPageCount: attachmentPageNumbers.length - applied.unassignedPages.length,
  };
}

function uniqueSorted(pages: number[]): number[] {
  return [...new Set(pages.filter((page) => Number.isInteger(page) && page > 0))].sort(
    (left, right) => left - right,
  );
}

/**
 * Model reply that names which agenda item owns which attachment pages.
 * Throws when the reply is not JSON or has no assignments list.
 * Drops page values that are not positive integers.
 */
export function readAttachmentAssignments(
  text: string,
): Array<{ agendaItemId: string; pages: number[] }> {
  const parsed = JSON.parse(text) as { assignments?: unknown };
  if (!Array.isArray(parsed.assignments)) {
    throw new Error("Attachment assignment response did not include assignments.");
  }
  return parsed.assignments.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { agendaItemId?: unknown; pages?: unknown };
    if (typeof record.agendaItemId !== "string" || !Array.isArray(record.pages)) return [];
    const pages = record.pages.filter(
      (page): page is number => typeof page === "number" && Number.isInteger(page) && page > 0,
    );
    return [{ agendaItemId: record.agendaItemId, pages }];
  });
}
