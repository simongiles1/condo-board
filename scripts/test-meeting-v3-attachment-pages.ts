/**
 * Attachment pages after the agenda split, linked onto V3 agenda items.
 * Run: npx tsx --test scripts/test-meeting-v3-attachment-pages.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  linkCorrectedAttachmentPages,
  readAttachmentAssignments,
  selectCorrectedAttachmentPages,
} from "../lib/meeting-v3/attachment-pages";
import { formatSourcePages } from "../lib/meeting-v3/agenda-pages";

const pages = [
  { pageNumber: 4, heading: "Booster pump" },
  { pageNumber: 13, heading: "Quote" },
  { pageNumber: 14, heading: "Quote continued" },
  { pageNumber: 15, heading: "Other" },
];

describe("corrected attachment pages", () => {
  it("keeps pages after the split and requires a correction", () => {
    const selected = selectCorrectedAttachmentPages({
      pages,
      agendaContentEndsAtPage: 12,
      rewrites: [
        { pageNumber: 4, correctedText: "agenda" },
        { pageNumber: 13, correctedText: "  quote  " },
        { pageNumber: 14, correctedText: "more" },
        { pageNumber: 15, correctedText: "other" },
      ],
    });
    assert.deepEqual(
      selected.map((page) => page.pageNumber),
      [13, 14, 15],
    );
    assert.equal(selected[0]?.text, "quote");
  });

  it("returns no pages when the package has no attachment split", () => {
    const selected = selectCorrectedAttachmentPages({
      pages,
      agendaContentEndsAtPage: null,
      rewrites: pages.map((page) => ({ pageNumber: page.pageNumber, correctedText: "text" })),
    });
    assert.deepEqual(selected, []);
  });

  it("rejects an attachment page that has not been corrected", () => {
    assert.throws(
      () =>
        selectCorrectedAttachmentPages({
          pages,
          agendaContentEndsAtPage: 12,
          rewrites: [{ pageNumber: 13, correctedText: "quote" }],
        }),
      /Page 14 has not been corrected/,
    );
  });
});

describe("link corrected attachment pages", () => {
  it("keeps agenda pages and claims a cited range before the model", () => {
    const linked = linkCorrectedAttachmentPages({
      agendaContentEndsAtPage: 12,
      items: [
        {
          id: "pump",
          sourcePages: [4],
          citationText: "Booster pump (Pages 13-14)",
        },
        {
          id: "other",
          sourcePages: [5],
          citationText: "No citation",
        },
      ],
      attachmentPageNumbers: [13, 14, 15],
      modelAssignments: [{ agendaItemId: "other", pages: [13, 15] }],
    });
    assert.deepEqual(linked.pagesByItemId.get("pump"), [4, 13, 14]);
    assert.deepEqual(linked.pagesByItemId.get("other"), [5, 15]);
    assert.deepEqual(linked.unassignedPages, []);
    assert.equal(linked.assignedPageCount, 3);
  });

  it("leaves an uncited page unassigned when the model omits it", () => {
    const linked = linkCorrectedAttachmentPages({
      agendaContentEndsAtPage: 12,
      items: [{ id: "pump", sourcePages: [4], citationText: "" }],
      attachmentPageNumbers: [13],
      modelAssignments: [],
    });
    assert.deepEqual(linked.pagesByItemId.get("pump"), [4]);
    assert.deepEqual(linked.unassignedPages, [13]);
    assert.equal(linked.assignedPageCount, 0);
  });

  it("does nothing when there is no split", () => {
    const linked = linkCorrectedAttachmentPages({
      agendaContentEndsAtPage: null,
      items: [{ id: "pump", sourcePages: [4, 16], citationText: "(Pages 16)" }],
      attachmentPageNumbers: [16],
      modelAssignments: [],
    });
    assert.deepEqual(linked.pagesByItemId.get("pump"), [4, 16]);
    assert.deepEqual(linked.unassignedPages, []);
    assert.equal(linked.assignedPageCount, 0);
  });
});

describe("attachment assignment reply", () => {
  it("reads item ids and page numbers", () => {
    const assignments = readAttachmentAssignments(
      JSON.stringify({ assignments: [{ agendaItemId: "pump", pages: [15, 1.5, "13"] }] }),
    );
    assert.deepEqual(assignments, [{ agendaItemId: "pump", pages: [15] }]);
  });

  it("rejects a reply with no assignments list", () => {
    assert.throws(() => readAttachmentAssignments("{}"), /assignments/);
  });
});

describe("source page labels", () => {
  it("collapses a contiguous range and keeps a gap visible", () => {
    assert.equal(formatSourcePages([4]), "page 4");
    assert.equal(formatSourcePages([4, 5, 6]), "pages 4–6");
    assert.equal(formatSourcePages([13, 4, 14]), "pages 4, 13–14");
    assert.equal(formatSourcePages([]), null);
  });
});
