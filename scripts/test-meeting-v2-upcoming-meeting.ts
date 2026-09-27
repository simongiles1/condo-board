/**
 * Upcoming-meeting split and attachment-page assignment.
 * Run: npx tsx --test scripts/test-meeting-v2-upcoming-meeting.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyAttachmentPageAssignments,
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

  it("keeps later package pages when the agenda boundary defaults to page 12", () => {
    const selected = Array.from({ length: 80 }, (_, index) => index + 1);
    assert.equal(defaultAgendaBoundaryPage(selected), 12);
    assert.deepEqual(omittedPageRanges(80, selected), []);
    assert.deepEqual(omittedPageRanges(80, selected.slice(0, 13)), [{ start: 14, end: 80 }]);
    assert.equal(defaultAgendaBoundaryPage([1, 2, 3, 4]), 3);
  });
});
