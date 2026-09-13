/**
 * Date matching for reuse of archive board packages in Minutes V2 create.
 * Run: npx tsx --test scripts/test-match-board-package.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isBoardPackageFilename } from "../lib/email/file-categories";
import {
  matchBoardPackageForMeetingDate,
  parsedBoardPackageIsoDate,
} from "../lib/meeting-v2/match-board-package";

describe("isBoardPackageFilename", () => {
  it("treats dated management reports as the circulated packet", () => {
    assert.equal(
      isBoardPackageFilename("Management Report Aug 6, 2026 (TSCC 2517).pdf"),
      true,
    );
    assert.equal(
      isBoardPackageFilename(
        "Board meeting package for board meeting on Feb. 25, 2026.pdf",
      ),
      true,
    );
  });

  it("does not treat sibling financial files as the packet", () => {
    assert.equal(isBoardPackageFilename("2517 TSCC FS June 2026 (1).pdf"), false);
    assert.equal(
      isBoardPackageFilename("TSCC 2517 Financial Notes June 2026.pdf"),
      false,
    );
    assert.equal(
      isBoardPackageFilename("Management Office Closure – Canada Day.pdf"),
      false,
    );
  });
});

describe("parsedBoardPackageIsoDate", () => {
  it("reads month-name meeting dates from package filenames", () => {
    assert.equal(
      parsedBoardPackageIsoDate(
        "TSCC 2517- Board meeting package for board meeting on June. 18, 2025.pdf",
      ),
      "2025-06-18",
    );
    assert.equal(
      parsedBoardPackageIsoDate(
        "TSCC 2517- board meeting package August 12, 2026.pdf",
      ),
      "2026-08-12",
    );
    assert.equal(
      parsedBoardPackageIsoDate(
        "Management Report Aug 6, 2026 (TSCC 2517).pdf",
      ),
      "2026-08-06",
    );
  });
});

describe("matchBoardPackageForMeetingDate", () => {
  it("selects the exact filename date over a closer received-at", () => {
    const result = matchBoardPackageForMeetingDate("2026-08-12", [
      {
        id: "wrong",
        filename: "unrelated.pdf",
        receivedAt: "2026-08-12T10:00:00.000Z",
        sizeBytes: 1,
        parsedDate: null,
      },
      {
        id: "exact",
        filename: "TSCC 2517- board meeting package August 12, 2026.pdf",
        receivedAt: "2026-08-01T10:00:00.000Z",
        sizeBytes: 1,
        parsedDate: "2026-08-12",
      },
    ]);

    assert.equal(result.matchKind, "exact");
    assert.equal(result.selectedId, "exact");
  });

  it("prefers a package dated on or before the meeting when distances tie", () => {
    const result = matchBoardPackageForMeetingDate("2026-08-12", [
      {
        id: "after",
        filename: "after.pdf",
        receivedAt: "2026-08-20T00:00:00.000Z",
        sizeBytes: 1,
        parsedDate: "2026-08-19",
      },
      {
        id: "before",
        filename: "before.pdf",
        receivedAt: "2026-08-01T00:00:00.000Z",
        sizeBytes: 1,
        parsedDate: "2026-08-05",
      },
    ]);

    assert.equal(result.matchKind, "nearest");
    assert.equal(result.selectedId, "before");
  });

  it("uses the prior meeting packet for a continuation date", () => {
    const result = matchBoardPackageForMeetingDate("2026-08-12", [
      {
        id: "feb",
        filename: "Board meeting package for board meeting on Feb. 25, 2026.pdf",
        receivedAt: "2026-02-23T12:00:00.000Z",
        sizeBytes: 1,
        parsedDate: "2026-02-25",
      },
      {
        id: "aug6",
        filename: "Management Report Aug 6, 2026 (TSCC 2517).pdf",
        receivedAt: "2026-07-31T23:30:00.000Z",
        sizeBytes: 1,
        parsedDate: "2026-08-06",
      },
    ]);

    assert.equal(result.matchKind, "nearest");
    assert.equal(result.selectedId, "aug6");
  });
});
