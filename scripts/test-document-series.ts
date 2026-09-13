/**
 * Recurring document series clustering and LLM name parsing.
 * Run: npx tsx --test scripts/test-document-series.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSeriesIdentityText,
  clusterByCosine,
  clusterLooksRecurring,
  parseDocumentSeriesUsage,
  parseSeriesNameProposals,
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

describe("clusterByCosine", () => {
  it("joins near-identical vectors and leaves an outlier alone", () => {
    const a = [1, 0, 0];
    const b = [0.99, 0.1, 0];
    const c = [0, 1, 0];
    const groups = clusterByCosine([a, b, c], 0.9);
    const sorted = groups.map((g) => [...g].sort((x, y) => x - y));
    assert.deepEqual(
      sorted.find((g) => g.length === 2),
      [0, 1],
    );
    assert.deepEqual(
      sorted.find((g) => g.length === 1),
      [2],
    );
  });
});

describe("parseSeriesNameProposals", () => {
  it("merges clusters, maps usage aliases, and ignores unknown ids", () => {
    const proposals = parseSeriesNameProposals(
      {
        series: [
          {
            title: "Board meeting packages",
            description: "Circulated pre-meeting packet",
            clusterIds: [0, 2, 2, 9],
            usage: "board_meeting_package",
            drop: false,
          },
          {
            title: "One-off",
            clusterIds: [1],
            drop: true,
          },
        ],
      },
      new Set([0, 1, 2]),
      new Set<string>(),
    );
    assert.equal(proposals.length, 2);
    assert.deepEqual(proposals[0]?.clusterIds, [0, 2]);
    assert.equal(proposals[0]?.usage, "board_package");
    assert.equal(proposals[1]?.drop, true);
  });
});

describe("buildSeriesIdentityText", () => {
  it("puts a date-stripped role label ahead of the instance date", () => {
    const text = buildSeriesIdentityText({
      filename: "Management Report Aug 6, 2026 (TSCC 2517).pdf",
      documentType: "other",
      documentDate: "2026-08-06",
      coveringEmailContext: "Board Meeting Package for Review",
      summary: "Agenda, ratifications, and the property management report.",
    });
    assert.match(text, /Role label: Management Report \(TSCC 2517\)/);
    assert.match(text, /Instance date: 2026-08-06/);
    assert.match(text, /Board Meeting Package/);
  });
});

describe("parseDocumentSeriesUsage", () => {
  it("accepts consumer bindings and rejects free titles", () => {
    assert.equal(parseDocumentSeriesUsage("minutes"), "minutes");
    assert.equal(parseDocumentSeriesUsage("Board packages"), null);
  });
});
