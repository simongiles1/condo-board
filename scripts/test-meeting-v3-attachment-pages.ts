/**
 * Attachment pages after the agenda split, linked onto V3 agenda items.
 * Run: npx tsx --test scripts/test-meeting-v3-attachment-pages.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attachmentPageNumbersToLink,
  citationTextByAgendaItem,
  linkCorrectedAttachmentPages,
  readAttachmentAssignments,
  selectCorrectedAttachmentPages,
} from "../lib/meeting-v3/attachment-pages";
import { formatAttachmentPageRangeLabel, formatSourcePages, sourcePageContiguousRanges } from "../lib/meeting-v3/agenda-pages";

const pages = [
  { pageNumber: 4, heading: "Booster pump", extractedText: "agenda body" },
  { pageNumber: 13, heading: "Quote", extractedText: "quote from docling" },
  { pageNumber: 14, heading: "Quote continued", extractedText: "more docling" },
  { pageNumber: 15, heading: "Other", extractedText: "other docling" },
];

describe("corrected attachment pages", () => {
  it("keeps pages after the split and prefers a correction over Docling", () => {
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
      selected.pages.map((page) => page.pageNumber),
      [13, 14, 15],
    );
    assert.equal(selected.pages[0]?.text, "quote");
    assert.deepEqual(selected.pagesWithoutText, []);
  });

  it("returns no pages when the package has no attachment split", () => {
    const selected = selectCorrectedAttachmentPages({
      pages,
      agendaContentEndsAtPage: null,
      rewrites: pages.map((page) => ({ pageNumber: page.pageNumber, correctedText: "text" })),
    });
    assert.deepEqual(selected, { pages: [], pagesWithoutText: [] });
  });

  it("uses Docling extract when an attachment page was not corrected", () => {
    const selected = selectCorrectedAttachmentPages({
      pages,
      agendaContentEndsAtPage: 12,
      rewrites: [{ pageNumber: 13, correctedText: "quote" }],
    });
    assert.equal(selected.pages.find((page) => page.pageNumber === 14)?.text, "more docling");
  });

  it("keeps linking when a page has no body and no heading", () => {
    const selected = selectCorrectedAttachmentPages({
      pages: [
        { pageNumber: 13, heading: null, extractedText: "   " },
        { pageNumber: 14, heading: "  Quote  ", extractedText: "" },
        { pageNumber: 15, heading: null, extractedText: "more docling" },
      ],
      agendaContentEndsAtPage: 12,
      rewrites: [],
    });
    assert.deepEqual(selected.pagesWithoutText, [13]);
    assert.deepEqual(
      selected.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
      [
        { pageNumber: 14, text: "Quote" },
        { pageNumber: 15, text: "more docling" },
      ],
    );
  });
});

describe("agenda citation text", () => {
  const agenda = [
    "## 1. Steam Room Heat Pump Design, Tender and Construction Review",
    "Please find attached a copy of minutes. (Page 13 - 26)",
    "## 2. Main Lobby / Elevator Lobby Restoration Work – Certificate of Completion",
    "Please find a copy of the sign-off. (Page 27)",
    "## 1. Booster Pump Replacement – Base Specification and Alternative Options",
    "Please find the tender analysis report attached.",
    "(Page 28 - 82)",
    "## 2. Heat Exchanger Plate Pack Replacement / Rebuild",
    "(Page 83 - 97)",
  ].join("\n");

  it("keeps a citation with the topic it follows, including one that starts the next page", () => {
    const texts = citationTextByAgendaItem({
      items: [
        { id: "steam", title: "Steam Room Heat Pump Design, Tender and Construction Review" },
        { id: "lobby", title: "Main Lobby / Elevator Lobby Restoration Work – Certificate of Completion" },
        { id: "pump", title: "Booster Pump Replacement – Base Specification and Alternative Options" },
        { id: "exchanger", title: "Heat Exchanger Plate Pack Replacement / Rebuild" },
      ],
      agendaText: agenda,
    });
    const linked = linkCorrectedAttachmentPages({
      agendaContentEndsAtPage: 12,
      items: [
        { id: "steam", sourcePages: [3], citationText: texts.get("steam") ?? "" },
        { id: "lobby", sourcePages: [3], citationText: texts.get("lobby") ?? "" },
        { id: "pump", sourcePages: [4], citationText: texts.get("pump") ?? "" },
        { id: "exchanger", sourcePages: [5, 6], citationText: texts.get("exchanger") ?? "" },
      ],
      attachmentPageNumbers: Array.from({ length: 85 }, (_, index) => 13 + index),
      modelAssignments: [],
    });
    assert.match(texts.get("steam") ?? "", /13 - 26/);
    assert.doesNotMatch(texts.get("steam") ?? "", /Page 27/);
    assert.deepEqual(
      linked.pagesByItemId.get("steam")?.filter((page) => page > 12),
      Array.from({ length: 14 }, (_, index) => 13 + index),
    );
    assert.deepEqual(linked.pagesByItemId.get("lobby")?.filter((page) => page > 12), [27]);
    assert.deepEqual(
      linked.pagesByItemId.get("pump")?.filter((page) => page > 12),
      Array.from({ length: 55 }, (_, index) => 28 + index),
    );
    assert.deepEqual(
      linked.pagesByItemId.get("exchanger")?.filter((page) => page > 12),
      Array.from({ length: 15 }, (_, index) => 83 + index),
    );
  });

  it("matches a heading that inserts a one-letter token the title also has", () => {
    const texts = citationTextByAgendaItem({
      items: [
        { id: "leak", title: "PH Mechanical Room Make-Up Air Unit Leak Repair" },
        { id: "seal", title: "Heating Pump P-10A Seal Replacement" },
      ],
      agendaText: [
        "## 3. PH Mechanical Room Make-Up Air Unit Leak Repair:",
        "(*Page 98 - 102*)",
        "## 4. *Heating Pump P-10A Seal Replacement:*",
        "(Page 103 - 105)",
      ].join("\n"),
    });
    assert.match(texts.get("leak") ?? "", /98 - 102/);
    assert.doesNotMatch(texts.get("leak") ?? "", /103 - 105/);
    assert.match(texts.get("seal") ?? "", /103 - 105/);
  });
});

describe("link corrected attachment pages", () => {
  it("claims a cited range through pages that have no extracted text", () => {
    const stored = Array.from({ length: 14 }, (_, index) => {
      const pageNumber = 13 + index;
      const hasText = pageNumber <= 20;
      return {
        pageNumber,
        heading: hasText ? "Quote" : null,
        extractedText: hasText ? "quote" : "   ",
      };
    });
    const selected = selectCorrectedAttachmentPages({
      pages: stored,
      agendaContentEndsAtPage: 12,
      rewrites: [],
    });
    assert.deepEqual(selected.pagesWithoutText, [21, 22, 23, 24, 25, 26]);
    const linked = linkCorrectedAttachmentPages({
      agendaContentEndsAtPage: 12,
      items: [
        {
          id: "steam",
          sourcePages: [3],
          citationText: "(Page 13 - 26)",
        },
      ],
      attachmentPageNumbers: attachmentPageNumbersToLink(selected),
      modelAssignments: [],
    });
    assert.deepEqual(linked.pagesByItemId.get("steam"), [
      3, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    assert.deepEqual(linked.unassignedPages, []);
  });

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

  it("builds contiguous ranges for attachment badges", () => {
    assert.deepEqual(sourcePageContiguousRanges([13, 14, 15, 16, 26]), [
      { start: 13, end: 16 },
      { start: 26, end: 26 },
    ]);
    assert.equal(formatAttachmentPageRangeLabel(27, 27), "Page 27");
    assert.equal(formatAttachmentPageRangeLabel(28, 82), "Pages 28–82");
  });
});
