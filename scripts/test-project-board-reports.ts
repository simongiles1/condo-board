/**
 * Management-report discovery, slicing, and topic→registry matching.
 * Run: npx tsx --test scripts/test-project-board-reports.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBoardReportScanReview,
  classifyBoardDocumentName,
  isWaitingOnMarkdownDocument,
  matchBoardReportTopic,
  parseBoardReportAiMatches,
  parseBoardReportTopics,
  parseBoardReportTopicsFromModelText,
  parseReportDateFromFilename,
  sliceManagementReportMarkdown,
} from "../lib/projects/board-report-shared";

describe("classifyBoardDocumentName", () => {
  it("accepts dated standalone management reports", () => {
    assert.equal(
      classifyBoardDocumentName("Management Report_2022.06.20.pdf"),
      "management_report",
    );
    assert.equal(
      classifyBoardDocumentName("Management Report March. 23. 2026 (TSCC 2517).pdf"),
      "management_report",
    );
  });

  it("accepts board meeting packages for this corporation", () => {
    assert.equal(
      classifyBoardDocumentName(
        "TSCC 2517- Board meeting package for board meeting on June. 18, 2025.pdf",
      ),
      "board_package",
    );
  });

  it("rejects office notices, agreements, and 2573-only packages", () => {
    assert.equal(
      classifyBoardDocumentName("Management Office Closure – Canada Day.pdf"),
      null,
    );
    assert.equal(
      classifyBoardDocumentName("Original ICC Management Agreement - 2015.pdf"),
      null,
    );
    assert.equal(
      classifyBoardDocumentName(
        "Board Meeting Package for Board meeting on Sep. 27, 2023 (TSCC 2573).pdf BK.pdf",
      ),
      null,
    );
    assert.equal(classifyBoardDocumentName("Notice_of_Meeting_Package.pdf"), null);
  });
});

describe("parseReportDateFromFilename", () => {
  it("reads underscore dotted dates and month-name dates", () => {
    assert.equal(
      parseReportDateFromFilename("Management Report_2022.06.20.pdf"),
      "2022-06-20",
    );
    assert.equal(
      parseReportDateFromFilename(
        "Management Report March. 23. 2026 (TSCC 2517).pdf",
      ),
      "2026-03-23",
    );
    assert.equal(
      parseReportDateFromFilename("Management Report Aug 6. 2026 (TSCC 2517).pdf"),
      "2026-08-06",
    );
  });
});

describe("sliceManagementReportMarkdown", () => {
  it("keeps short standalone reports whole", () => {
    const text = "# Management Report\n\nMaglock installation is in progress.";
    assert.equal(
      sliceManagementReportMarkdown(text, {
        kind: "management_report",
        pageCount: 8,
      }),
      text,
    );
  });

  it("cuts a long package at the next major section", () => {
    const markdown = [
      "# Agenda",
      "Call to order",
      "## 4. Management Report",
      "Elevator modernization tender is out.",
      "## Financial Statements",
      "January variance report",
    ].join("\n");
    const sliced = sliceManagementReportMarkdown(markdown, {
      kind: "board_package",
      pageCount: 120,
    });
    assert.match(sliced, /Elevator modernization/);
    assert.doesNotMatch(sliced, /January variance/);
  });
});

describe("parseBoardReportTopics", () => {
  it("drops unnamed and too-generic topics", () => {
    const topics = parseBoardReportTopics({
      topics: [
        { name: "Maglock installation", section: "capital" },
        { name: "roof" },
        { name: "  " },
        { name: "Maglock installation" },
      ],
    });
    assert.deepEqual(
      topics.map((topic) => topic.name),
      ["Maglock installation"],
    );
  });

  it("parses fenced model JSON", () => {
    const topics = parseBoardReportTopicsFromModelText(`\`\`\`json
{"topics":[{"name":"EV charging","section":"discussion"}]}
\`\`\``);
    assert.equal(topics[0]?.name, "EV charging");
    assert.equal(topics[0]?.section, "discussion");
  });
});

describe("matchBoardReportTopic", () => {
  const maglock = {
    id: "name:maglock",
    name: "magnet",
    aliases: ["installation of electromagnetic locking devices"],
    yearHint: "2025-2026",
    equipmentMentions: "maglocks",
  };
  const maglockNameOnly = {
    id: "name:maglock-install",
    name: "Maglock installation",
    aliases: ["maglock system"],
  };
  const elevator = {
    id: "name:elevator",
    name: "Elevator modernization",
    aliases: [],
  };
  const kitchen2024 = {
    id: "name:kitchen-2024",
    name: "Kitchen stack cleaning",
    aliases: [],
    yearHint: "2024",
  };
  const kitchen2025 = {
    id: "name:kitchen-2025",
    name: "Kitchen stack cleaning",
    aliases: [],
    yearHint: "2025",
  };
  const roof = {
    id: "name:roof",
    name: "Roof restoration",
    aliases: [],
  };

  it("matches the same work name after filler words are stripped", () => {
    const hits = matchBoardReportTopic("Maglock installation", [
      maglockNameOnly,
      elevator,
      roof,
    ]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.projectId, "name:maglock-install");
    assert.equal(hits[0]?.confidence, "high");
  });

  it("matches Maglock onto a card whose equipment says maglocks", () => {
    const hits = matchBoardReportTopic("Maglock", [maglock, elevator]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.projectId, "name:maglock");
  });

  it("does not prefix-match a longer heading", () => {
    const hits = matchBoardReportTopic("Maglock system at Stair F", [
      maglockNameOnly,
      elevator,
    ]);
    assert.equal(hits.length, 0);
  });

  it("does not fuzzy-match unrelated work", () => {
    const hits = matchBoardReportTopic("Garage traffic topping", [
      maglockNameOnly,
      elevator,
    ]);
    assert.equal(hits.length, 0);
  });

  it("skips a generic one-word topic", () => {
    const hits = matchBoardReportTopic("roof", [roof]);
    assert.equal(hits.length, 0);
  });

  it("keeps yearly campaign cards from crossing years", () => {
    const hits = matchBoardReportTopic(
      { name: "Kitchen stack cleaning", yearHint: "2024" },
      [kitchen2024, kitchen2025],
    );
    assert.deepEqual(
      hits.map((hit) => hit.projectId),
      ["name:kitchen-2024"],
    );
  });
});

describe("parseBoardReportAiMatches", () => {
  it("maps Maglock onto the electromagnetic-lock card by id", () => {
    const rows = parseBoardReportAiMatches(
      {
        matches: [
          {
            topicId: "t0",
            projectIds: ["name:magnet"],
            confidence: "high",
          },
        ],
      },
      new Set(["name:magnet", "name:elevator"]),
      [{ id: "t0", name: "Maglock" }],
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.projectIds, ["name:magnet"]);
  });

  it("drops unknown ids and low confidence", () => {
    const rows = parseBoardReportAiMatches(
      {
        matches: [
          {
            topicId: "t0",
            projectIds: ["invented"],
            confidence: "high",
          },
          {
            topicId: "t1",
            projectIds: ["name:elevator"],
            confidence: "low",
          },
        ],
      },
      new Set(["name:elevator"]),
      [
        { id: "t0", name: "Maglock" },
        { id: "t1", name: "Elevator modernization" },
      ],
    );
    assert.equal(rows.length, 0);
  });
});

describe("buildBoardReportScanReview", () => {
  it("lists unmatched topics and skipped packages", () => {
    const review = buildBoardReportScanReview({
      documents: [
        {
          id: "parsed",
          filename: "Management Report_2025.06.01.pdf",
          kind: "management_report",
          reportDate: "2025-06-01",
          receivedAt: "2025-06-02",
          pageCount: 12,
          parseStatus: "parsed",
          error: null,
          emailId: "e1",
          topics: [
            {
              name: "Maglock",
              section: "capital",
              contractor: null,
              location: null,
              yearHint: "2025",
              notes: null,
              matchedProjectIds: [],
            },
            {
              name: "Elevator modernization",
              section: "capital",
              contractor: null,
              location: null,
              yearHint: null,
              notes: null,
              matchedProjectIds: ["name:elevator"],
            },
          ],
        },
        {
          id: "skip",
          filename: "TSCC 2517- Board meeting package.pdf",
          kind: "board_package",
          reportDate: "2026-03-23",
          receivedAt: "2026-03-20",
          pageCount: 140,
          parseStatus: "pending",
          error: "Attachment markdown has not been converted yet.",
          emailId: "e2",
          topics: [],
        },
      ],
    });
    assert.equal(review.unmatchedTopics.length, 1);
    assert.equal(review.unmatchedTopics[0]?.name, "Maglock");
    assert.equal(review.unmatchedTopics[0]?.mentionCount, 1);
    assert.equal(review.waitingOnMarkdown.length, 1);
    assert.equal(
      review.waitingOnMarkdown[0]?.filename,
      "TSCC 2517- Board meeting package.pdf",
    );
  });
});

describe("isWaitingOnMarkdownDocument", () => {
  it("treats pending and empty-markdown errors as waiting", () => {
    assert.equal(
      isWaitingOnMarkdownDocument({ parseStatus: "pending", error: null }),
      true,
    );
    assert.equal(
      isWaitingOnMarkdownDocument({
        parseStatus: "parsed",
        error: "Parsed markdown was empty or missing from storage.",
      }),
      true,
    );
    assert.equal(
      isWaitingOnMarkdownDocument({ parseStatus: "parsed", error: null }),
      false,
    );
  });
});
