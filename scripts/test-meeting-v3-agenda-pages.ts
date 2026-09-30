/**
 * Corrected-page selection for the V3 agenda.
 * Run: npx tsx --test scripts/test-meeting-v3-agenda-pages.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readAgendaSourcePages,
  readAgendaVendors,
  selectCorrectedAgendaPages,
} from "../lib/meeting-v3/agenda-pages";

const pages = [
  { pageNumber: 1, heading: "Agenda" },
  { pageNumber: 2, heading: "Minutes" },
  { pageNumber: 4, heading: "Booster pump" },
  { pageNumber: 16, heading: "Attachment" },
];

describe("corrected agenda pages", () => {
  it("uses the corrected text and stops at the agenda split", () => {
    const selected = selectCorrectedAgendaPages({
      pages,
      agendaContentEndsAtPage: 12,
      rewrites: [
        { pageNumber: 1, correctedText: "  agenda page  " },
        { pageNumber: 2, correctedText: "minutes" },
        { pageNumber: 4, correctedText: "pump" },
        { pageNumber: 16, correctedText: "attachment" },
      ],
    });
    assert.deepEqual(
      selected.map((page) => page.pageNumber),
      [1, 2, 4],
    );
    assert.equal(selected[0]?.text, "agenda page");
    assert.equal(selected.some((page) => page.text === "attachment"), false);
  });

  it("requires a correction on every agenda page", () => {
    assert.throws(
      () => selectCorrectedAgendaPages({
        pages,
        agendaContentEndsAtPage: 12,
        rewrites: [
          { pageNumber: 1, correctedText: "agenda" },
          { pageNumber: 2, correctedText: "minutes" },
        ],
      }),
      /Page 4 has not been corrected/,
    );
  });

  it("rejects a split that leaves no agenda pages", () => {
    assert.throws(
      () => selectCorrectedAgendaPages({
        pages: [{ pageNumber: 8, heading: null }],
        agendaContentEndsAtPage: 4,
        rewrites: [{ pageNumber: 8, correctedText: "later" }],
      }),
      /no agenda pages/,
    );
  });
});

describe("stored agenda fields", () => {
  it("reads page numbers and vendor names", () => {
    assert.deepEqual(readAgendaSourcePages("[4,5]"), [4, 5]);
    assert.deepEqual(readAgendaSourcePages("not json"), []);
    assert.deepEqual(readAgendaVendors('["NWP","ABM"]'), ["NWP", "ABM"]);
    assert.deepEqual(readAgendaVendors(null), []);
  });
});
