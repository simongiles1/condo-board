/**
 * Upcoming-meeting split and attachment-page assignment.
 * Run: npx tsx --test scripts/test-meeting-v2-upcoming-meeting.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachmentPageCards, buildAttachmentMap } from "../lib/meeting-v2/attachment-map";
import {
  applyAttachmentPageAssignments,
  citedAttachmentAssignments,
  mergeCitedAttachmentPages,
  parseAgendaContentEndsAtPage,
} from "../lib/meeting-v2/upcoming-meeting";
import {
  defaultAgendaBoundaryPage,
  omittedPageRanges,
} from "../lib/pdf/page-selection";

describe("upcoming meeting package split", () => {
  it("rejects a split that leaves no attachment pages", () => {
    assert.equal(parseAgendaContentEndsAtPage(4, 4), null);
    assert.equal(parseAgendaContentEndsAtPage(0, 8), null);
    assert.equal(parseAgendaContentEndsAtPage(3, 8), 3);
  });

  it("moves attachment pages onto the assigned leaf and keeps agenda pages", () => {
    const applied = applyAttachmentPageAssignments({
      agendaContentEndsAtPage: 4,
      attachmentPageNumbers: [5, 6, 7],
      leaves: [
        { id: "steam", sourcePages: [2, 6] },
        { id: "budget", sourcePages: [3] },
      ],
      assignments: [
        { agendaItemId: "steam", pages: [5, 6] },
        { agendaItemId: "missing", pages: [7] },
      ],
    });

    assert.deepEqual(applied.pagesByLeafId.get("steam"), [2, 5, 6]);
    assert.deepEqual(applied.pagesByLeafId.get("budget"), [3]);
    assert.deepEqual(applied.unassignedPages, [7]);
  });

  it("keeps model-linked pages and adds the rest of a citation the model omitted", () => {
    const cited = citedAttachmentAssignments({
      leaves: [
        {
          id: "steam",
          text: "Please find attached a copy of minutes. (Page ... ... ...) 13 - 26",
        },
      ],
      attachmentPageNumbers: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
    });
    assert.deepEqual(cited, [
      { agendaItemId: "steam", pages: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26] },
    ]);

    const merged = mergeCitedAttachmentPages({
      leaves: [
        {
          id: "steam",
          sourcePages: [2, 13, 14, 15, 16, 17, 18, 19, 20],
          text: "Please find attached a copy of minutes. (Page ... ... ...) 13 - 26",
        },
      ],
      attachmentPageNumbers: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
    });
    assert.equal(merged.changed, true);
    assert.deepEqual(
      merged.pagesByLeafId.get("steam"),
      [2, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
    );
    assert.deepEqual(merged.unassignedPages, [27]);
  });

  it("keeps later package pages when the agenda boundary defaults to page 12", () => {
    const selected = Array.from({ length: 80 }, (_, index) => index + 1);
    assert.equal(defaultAgendaBoundaryPage(selected), 12);
    assert.deepEqual(omittedPageRanges(80, selected), []);
    assert.deepEqual(omittedPageRanges(80, selected.slice(0, 13)), [{ start: 14, end: 80 }]);
    assert.equal(defaultAgendaBoundaryPage([1, 2, 3, 4]), 3);
  });
});

describe("attachment map review", () => {
  it("treats pages after the agenda split as attachments and leaves the rest as gaps", () => {
    const map = buildAttachmentMap({
      agendaContentEndsAtPage: 12,
      pageCount: 30,
      items: [
        { id: "guests", itemNumber: "1.A", title: "Booster Pump", sourcePages: [2] },
        {
          id: "lobby",
          itemNumber: "4.A.2",
          title: "Main Lobby",
          sourcePages: [8, 13, 14, 15, 16],
        },
        { id: "budget", itemNumber: "3", title: "Financial statements", sourcePages: [6, 28, 30] },
      ],
    });

    const guests = map.rows.find((row) => row.agendaItemId === "guests");
    const lobby = map.rows.find((row) => row.agendaItemId === "lobby");
    const budget = map.rows.find((row) => row.agendaItemId === "budget");
    assert.deepEqual(guests?.attachmentRanges, []);
    assert.deepEqual(lobby?.attachmentRanges, [{ start: 13, end: 16 }]);
    assert.deepEqual(budget?.attachmentRanges, [
      { start: 28, end: 28 },
      { start: 30, end: 30 },
    ]);
    assert.equal(map.itemsWithoutAttachments, 1);
    assert.deepEqual(
      map.bands.filter((band) => band.kind === "gap").map((band) => [band.start, band.end]),
      [
        [17, 27],
        [29, 29],
      ],
    );
    assert.equal(map.unlinkedAttachmentPages, 12);
    assert.deepEqual(map.bands[0], { kind: "agenda", start: 1, end: 12 });
    const cards = attachmentPageCards(map.bands);
    assert.equal(cards.find((card) => card.page === 13)?.agendaItemId, "lobby");
    assert.equal(cards.find((card) => card.page === 27)?.agendaItemId, null);
    assert.equal(cards.some((card) => card.page <= 12), false);
    assert.equal(cards.length, 18);
  });
});
