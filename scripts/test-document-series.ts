/**
 * Recurring document series catalog/assignment parsing.
 * Run: npx tsx --test scripts/test-document-series.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clusterLooksRecurring,
  groupByInstanceKey,
  groupByRecurringRole,
  isSeriesDiscoveryEligible,
  keepRecurringSubtypeMembers,
  parseDocumentSeriesUsage,
  parseSeriesAssignments,
  parseSeriesCatalog,
  parseSeriesSubtypeAssignments,
  recurringRoleKey,
  sampleSeriesDiscoveryDocs,
  seriesInstanceKey,
  seriesKeyFromTitle,
  stripTemporalTokens,
  titleFromInstanceKey,
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

describe("seriesInstanceKey", () => {
  it("strips dates and weekdays so dated copies share a stem", () => {
    assert.equal(
      seriesInstanceKey("Management Office Hours (Friday, August 14, 2026).pdf"),
      "management office hours",
    );
    assert.equal(
      seriesInstanceKey("Scheduled Hot Water Interruption.pdf"),
      "scheduled hot water interruption",
    );
    assert.notEqual(
      seriesInstanceKey("Temporary Closure of Hot Tubs.pdf"),
      seriesInstanceKey("Scheduled Hot Water Interruption.pdf"),
    );
  });

  it("strips corp codes and package filler so ICC filename variants share a stem", () => {
    assert.equal(
      seriesInstanceKey(
        "Board Meeting Package for board meeting on May. 19, 2026.pdf",
      ),
      "board meeting package",
    );
    assert.equal(
      seriesInstanceKey(
        "TSCC 2517-Board Meeting Package for Board Meeting on Nov. 17, 2025.pdf",
      ),
      "board meeting package",
    );
    assert.equal(
      seriesInstanceKey("Board meeting package dtd Jan 5, 2026.pdf"),
      "board meeting package",
    );
  });
});

describe("recurringRoleKey", () => {
  it("collapses management-report packets with board-package filenames", () => {
    const packetSummary =
      "A 216-page board meeting package for TSCC 2517 containing the management report.";
    assert.equal(
      recurringRoleKey({
        filename: "Management Report Aug 6. 2026 (TSCC 2517).pdf",
        summary: packetSummary,
        parentUsage: "board_package",
      }),
      "board meeting package",
    );
    assert.equal(
      recurringRoleKey({
        filename:
          "TSCC 2517-Board Meeting Package for Board Meeting on Nov. 17, 2025.pdf",
        summary: packetSummary,
        parentUsage: "board_package",
      }),
      "board meeting package",
    );
    assert.equal(
      recurringRoleKey({
        filename: "Board Meeting Agenda Aug 6, 2026.pdf",
        summary: "Standalone agenda for the August 6 virtual board meeting.",
        parentUsage: "board_package",
      }),
      "board meeting agenda",
    );
  });
});

describe("groupByRecurringRole", () => {
  it("puts ICC packet filename variants in one bucket and agendas in another", () => {
    const groups = groupByRecurringRole(
      [
        {
          filename: "Management Report Aug 6. 2026 (TSCC 2517).pdf",
          summary: "A 216-page board meeting package for TSCC 2517.",
        },
        {
          filename:
            "Board Meeting Package for board meeting on May. 19, 2026.pdf",
          summary: "A 141-page board meeting package.",
        },
        {
          filename: "Board Meeting Agenda May 19, 2026.pdf",
          summary: "Agenda for the May 19 board meeting.",
        },
      ],
      "board_package",
    );
    const packet = groups.find(
      (row) => row.instanceKey === "board meeting package",
    );
    const agenda = groups.find(
      (row) => row.instanceKey === "board meeting agenda",
    );
    assert.equal(packet?.docs.length, 2);
    assert.equal(agenda?.docs.length, 1);
  });
});

describe("titleFromInstanceKey", () => {
  it("title-cases a stem", () => {
    assert.equal(titleFromInstanceKey("management office hours"), "Management Office Hours");
  });
});

describe("groupByInstanceKey", () => {
  it("groups dated copies and leaves unique events alone", () => {
    const groups = groupByInstanceKey([
      { filename: "Management Office Hours (Friday, August 14, 2026).pdf" },
      { filename: "Management Office Hours (Friday, August 7, 2026).pdf" },
      { filename: "Temporary Closure of Hot Tubs.pdf" },
    ]);
    const office = groups.find((row) => row.instanceKey === "management office hours");
    const hotTubs = groups.find(
      (row) => row.instanceKey === "temporary closure of hot tubs",
    );
    assert.equal(office?.docs.length, 2);
    assert.equal(hotTubs?.docs.length, 1);
  });
});

describe("keepRecurringSubtypeMembers", () => {
  it("keeps subtypes with two dates and drops singleton one-offs", () => {
    const kept = keepRecurringSubtypeMembers([
      {
        contentHash: "office-1",
        receivedAt: "2026-08-06T00:00:00.000Z",
        subtypeKey: "office-hours",
        subtypeTitle: "Office hours",
      },
      {
        contentHash: "office-2",
        receivedAt: "2026-07-29T00:00:00.000Z",
        subtypeKey: "office-hours",
        subtypeTitle: "Office hours",
      },
      {
        contentHash: "tubs",
        receivedAt: "2026-07-09T00:00:00.000Z",
        subtypeKey: "hot-tub-closure",
        subtypeTitle: "Hot tub closure",
      },
    ]);
    assert.deepEqual(
      kept.map((row) => row.contentHash).sort(),
      ["office-1", "office-2"],
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

describe("parseSeriesSubtypeAssignments", () => {
  it("maps stems to subtype keys or not-recurring", () => {
    const assignments = parseSeriesSubtypeAssignments(
      {
        assignments: [
          { id: 0, subtypeKey: "office-hours", subtypeTitle: "Office hours" },
          { id: 1, subtypeKey: null },
          { id: 2, subtypeTitle: "Hot water interruptions" },
        ],
      },
      new Set([0, 1, 2]),
    );
    assert.equal(assignments.length, 3);
    assert.equal(assignments[0]?.subtypeKey, "office-hours");
    assert.equal(assignments[1]?.subtypeKey, null);
    assert.equal(assignments[2]?.subtypeKey, "hot-water-interruptions");
    assert.equal(assignments[2]?.subtypeTitle, "Hot water interruptions");
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
