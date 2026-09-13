/**
 * Recurring document series catalog/assignment parsing.
 * Run: npx tsx --test scripts/test-document-series.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clusterLooksRecurring,
  isSeriesDiscoveryEligible,
  parseDocumentSeriesUsage,
  parseSeriesAssignments,
  parseSeriesCatalog,
  sampleSeriesDiscoveryDocs,
  seriesKeyFromTitle,
  stripTemporalTokens,
} from "../lib/documents/series-shared";

describe("stripTemporalTokens", () => {
  it("collapses dated management reports to the same role label", () => {
    assert.equal(
      stripTemporalTokens("Management Report Aug 6, 2026 (TSCC 2517).pdf"),
      "Management Report (TSCC 2517).pdf",
    );
    assert.equal(
      stripTemporalTokens("Management Report March. 23. 2026 (TSCC 2517).pdf"),
      stripTemporalTokens("Management Report Aug 6, 2026 (TSCC 2517).pdf"),
    );
  });
});

describe("clusterLooksRecurring", () => {
  it("requires two distinct calendar days", () => {
    assert.equal(clusterLooksRecurring(["2026-08-06", "2026-08-06"]), false);
    assert.equal(clusterLooksRecurring(["2026-08-06", "2026-02-25"]), true);
    assert.equal(
      clusterLooksRecurring(["2026-08-06T12:00:00.000Z", "2026-08-12T18:00:00.000Z"]),
      true,
    );
  });
});

describe("isSeriesDiscoveryEligible", () => {
  it("skips valueless, image, and decorative filenames", () => {
    assert.equal(
      isSeriesDiscoveryEligible({
        mimeType: "application/pdf",
        filename: "Minutes.pdf",
        hasValue: true,
      }),
      true,
    );
    assert.equal(
      isSeriesDiscoveryEligible({
        mimeType: "application/pdf",
        filename: "Minutes.pdf",
        hasValue: false,
      }),
      false,
    );
    assert.equal(
      isSeriesDiscoveryEligible({
        mimeType: "image/png",
        filename: "notice.png",
        hasValue: true,
      }),
      false,
    );
    assert.equal(
      isSeriesDiscoveryEligible({
        mimeType: "application/pdf",
        filename: "image001.png",
        hasValue: true,
      }),
      false,
    );
    assert.equal(
      isSeriesDiscoveryEligible({
        mimeType: "application/pdf",
        filename: "Screenshot 2025-04-23 at 9.30.58 AM.png",
        hasValue: true,
      }),
      false,
    );
  });
});

describe("sampleSeriesDiscoveryDocs", () => {
  it("round-robins across type and filename buckets", () => {
    const docs = [
      { documentType: "letter", filename: "Office Hours Aug 6.pdf" },
      { documentType: "letter", filename: "Office Hours Aug 13.pdf" },
      { documentType: "minutes", filename: "Minutes Aug 6.pdf" },
      { documentType: "tables", filename: "GL Aug 6.pdf" },
    ];
    const sampled = sampleSeriesDiscoveryDocs(docs, 3);
    const types = new Set(sampled.map((doc) => doc.documentType));
    assert.equal(sampled.length, 3);
    assert.ok(types.size >= 2);
  });
});

describe("parseSeriesCatalog", () => {
  it("slugs keys, maps usage aliases, and keeps known existing ids", () => {
    const entries = parseSeriesCatalog(
      {
        series: [
          {
            key: "Board Meeting Packages",
            title: "Board meeting packages",
            description: "Circulated pre-meeting packet",
            usage: "board_meeting_package",
            existingId: "keep-me",
          },
          {
            title: "Monthly financial statements",
            usage: "financial_statements",
            existingId: "unknown",
          },
          { title: "" },
        ],
      },
      new Set(["keep-me"]),
    );
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.key, "board-meeting-packages");
    assert.equal(entries[0]?.usage, "board_package");
    assert.equal(entries[0]?.existingId, "keep-me");
    assert.equal(entries[1]?.existingId, null);
    assert.equal(entries[1]?.key, "monthly-financial-statements");
  });
});

describe("parseSeriesAssignments", () => {
  it("maps ids to catalog keys, new titles, or not-recurring", () => {
    const assignments = parseSeriesAssignments(
      {
        assignments: [
          { id: 0, seriesKey: "minutes" },
          { id: 1, seriesKey: null },
          { id: 2, newTitle: "Resident notices" },
          { id: 2, seriesKey: "dup" },
          { id: 9, seriesKey: "minutes" },
        ],
      },
      new Set([0, 1, 2]),
    );
    assert.equal(assignments.length, 3);
    assert.equal(assignments[0]?.seriesKey, "minutes");
    assert.equal(assignments[1]?.seriesKey, null);
    assert.equal(assignments[2]?.seriesKey, "resident-notices");
    assert.equal(assignments[2]?.newTitle, "Resident notices");
  });
});

describe("seriesKeyFromTitle", () => {
  it("kebab-cases titles", () => {
    assert.equal(seriesKeyFromTitle("Board meeting packages"), "board-meeting-packages");
  });
});

describe("parseDocumentSeriesUsage", () => {
  it("accepts consumer bindings and rejects free titles", () => {
    assert.equal(parseDocumentSeriesUsage("minutes"), "minutes");
    assert.equal(parseDocumentSeriesUsage("Board packages"), null);
  });
});
