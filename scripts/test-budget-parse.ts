/**
 * Operating-budget filename classification and markdown GL extraction.
 * Run: npx tsx --test scripts/test-budget-parse.ts
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  classifyBudgetFilename,
  isOperatingBudgetForThisCorporation,
  rankOperatingBudgetFilename,
} from "../lib/budget/classify-documents";
import {
  lineItemLinearity,
  relativeLineFit,
} from "../lib/budget/linearity";
import {
  mergeParsedBudgetDocuments,
  parseAmountCell,
  parseBudgetMarkdown,
  toBudgetLineItems,
} from "../lib/budget/parse-markdown";

describe("classifyBudgetFilename", () => {
  it("classifies TSCC 2517 templates and packages as operating budgets", () => {
    const template = classifyBudgetFilename(
      "TSCC 2517 Budget Template 2025-2026 (BK) (Board) Apr 15 Final.pdf",
    );
    assert.deepEqual(template, {
      kind: "operating-budget",
      fiscalYearStart: 2025,
      isThisCorporation: true,
    });

    const pack = classifyBudgetFilename(
      "TSCC 2517 Budget Package 2024-2025 (BK)(MW)2 Final.pdf",
    );
    assert.equal(pack?.kind, "operating-budget");
    assert.equal(pack?.fiscalYearStart, 2024);

    const named = classifyBudgetFilename("TSCC 2517 Budget 2022-2023 - Final.pdf");
    assert.equal(named?.kind, "operating-budget");
    assert.equal(named?.fiscalYearStart, 2022);
  });

  it("accepts a template with no corporation number as this building", () => {
    const classified = classifyBudgetFilename(
      "Budget Template 2026-2027 Revised.pdf",
    );
    assert.equal(classified?.kind, "operating-budget");
    assert.equal(classified?.isThisCorporation, true);
    assert.equal(classified?.fiscalYearStart, 2026);
  });

  it("excludes letters, notes, approval forms, and other corporations", () => {
    assert.equal(
      classifyBudgetFilename("TSCC 2517 - Budget Letter_2023 - AJ draft.docx")
        ?.kind,
      "budget-letter",
    );
    assert.equal(
      classifyBudgetFilename("2025 Budget Notes (BK).xlsx")?.kind,
      "budget-notes",
    );
    assert.equal(
      classifyBudgetFilename("Budget Approval Form (TSCC 2517).pdf")?.kind,
      "budget-approval",
    );
    assert.equal(
      classifyBudgetFilename(
        "TSCC 1864 Approved Budget July 1, 2022 to June 30, 2023 .pdf",
      )?.isThisCorporation,
      false,
    );
    assert.equal(
      isOperatingBudgetForThisCorporation(
        "Budget Prices - 199 Richmond Street Garage Repairs.xlsx",
      ),
      false,
    );
  });

  it("ranks Final PDFs above drafts", () => {
    const finalPdf = rankOperatingBudgetFilename(
      "TSCC 2517 Budget Template 2023-2024 - Final.pdf",
    );
    const draft = rankOperatingBudgetFilename(
      "TSCC 2517 Budget Template 2023-2024 v1.pdf",
    );
    assert.ok(finalPdf > draft);
  });
});

describe("parseAmountCell", () => {
  it("parses comma grouped, parenthetical negative, and underscore padded amounts", () => {
    assert.equal(parseAmountCell("2,419,700"), 2_419_700);
    assert.equal(parseAmountCell("(86,177)"), -86_177);
    assert.equal(parseAmountCell("__________ 2,504,737"), 2_504_737);
    assert.equal(parseAmountCell("Common Element Fees"), null);
  });
});

const SAMPLE_TABLE = `
| DESCRIPTION | DESCRIPTION | 2021-2022 BUDGET | 2021-2022 PROJECTED | 2022-2023 BUDGET | % BUDGET CHANGE |
|-------------|-----------------|------------------|---------------------|------------------|-----------------|
| REVENUE | | | | | |
| 4010 | Common Element Fees | 2,419,700 | 2,419,707 | 2,504,737 | 3.51 |
| 4415 | Save on Energy | 0 | 41,250 | 0 | |
| ADMINISTRATION EXPENSES | ADMINISTRATION EXPENSES | | | | |
| 5510 | Property Management Fees | 146,112 | 149,771 | 150,504 | |
| 6035 Water Recovery (86,177) (89,246) (86,177) | | | | | |
`;

const TWO_ROW_HEADER = `
| DESCRIPTION | DESCRIPTION | 2025-2026 | 2026-2027 | % BUDGET |
| DESCRIPTION | DESCRIPTION | PROJECTED | BUDGET | CHANGE |
| 6222 | Emergency Generator | 2,794 | 4,200 | |
`;

describe("parseBudgetMarkdown", () => {
  it("extracts GL lines, categories, and skips the percent column", () => {
    const { lines } = parseBudgetMarkdown(SAMPLE_TABLE);
    const fees = lines.find((line) => line.code === "4010");
    assert.ok(fees);
    assert.equal(fees.name, "Common Element Fees");
    assert.equal(fees.category, "Revenue");
    assert.deepEqual(
      fees.amounts.map((amount) => [
        amount.fiscalYearStart,
        amount.role,
        amount.value,
      ]),
      [
        [2021, "budget", 2_419_700],
        [2021, "projected", 2_419_707],
        [2022, "budget", 2_504_737],
      ],
    );

    const pm = lines.find((line) => line.code === "5510");
    assert.equal(pm?.category, "Administration");
    assert.equal(
      pm?.amounts.find((amount) => amount.fiscalYearStart === 2022)?.value,
      150_504,
    );
  });

  it("recovers amounts collapsed into the description cell", () => {
    const { lines } = parseBudgetMarkdown(SAMPLE_TABLE);
    const water = lines.find((line) => line.code === "6035");
    assert.ok(water);
    assert.equal(water.name, "Water Recovery");
    assert.deepEqual(
      water.amounts.map((amount) => amount.value),
      [-86_177, -89_246, -86_177],
    );
  });

  it("merges a year row with a BUDGET/PROJECTED continuation row", () => {
    const { lines } = parseBudgetMarkdown(TWO_ROW_HEADER);
    const generator = lines.find((line) => line.code === "6222");
    assert.ok(generator);
    assert.deepEqual(
      generator.amounts.map((amount) => [
        amount.fiscalYearStart,
        amount.role,
        amount.value,
      ]),
      [
        [2025, "projected", 2_794],
        [2026, "budget", 4_200],
      ],
    );
  });
});

describe("mergeParsedBudgetDocuments", () => {
  it("lets a later package supply actuals via prior-year projected", () => {
    const earlier = parseBudgetMarkdown(SAMPLE_TABLE);
    const later = parseBudgetMarkdown(`
| DESCRIPTION | 2022-2023 BUDGET | 2022-2023 PROJECTED | 2023-2024 BUDGET |
| 4010 | Common Element Fees | 2,504,737 | 2,476,389 | 2,676,648 |
`);
    const merged = toBudgetLineItems(
      mergeParsedBudgetDocuments([
        { rank: 110, receivedAt: "2022-04-01", parsed: earlier },
        { rank: 110, receivedAt: "2023-04-01", parsed: later },
      ]),
    );
    const fees = merged.find((line) => line.code === "4010");
    assert.equal(fees?.byYear[2022]?.budgeted, 2_504_737);
    assert.equal(fees?.byYear[2022]?.actual, 2_476_389);
    assert.equal(fees?.byYear[2023]?.budgeted, 2_676_648);
  });

  it("prefers Final rank over a draft for the same field", () => {
    const draft = parseBudgetMarkdown(`
| DESCRIPTION | 2023-2024 BUDGET |
| 5510 | Property Management Fees | 150,504 |
`);
    const finalDoc = parseBudgetMarkdown(`
| DESCRIPTION | 2023-2024 BUDGET |
| 5510 | Property Management Fees | 156,774 |
`);
    const merged = toBudgetLineItems(
      mergeParsedBudgetDocuments([
        { rank: 10, receivedAt: "2023-03-01", parsed: draft },
        { rank: 110, receivedAt: "2023-02-01", parsed: finalDoc },
      ]),
    );
    assert.equal(
      merged.find((line) => line.code === "5510")?.byYear[2023]?.budgeted,
      156_774,
    );
  });
});

describe("lineItemLinearity", () => {
  const years = [2022, 2023, 2024, 2025];

  it("returns 100% for a perfectly linear budgeted series", () => {
    const score = lineItemLinearity(
      {
        byYear: {
          2022: { budgeted: 100_000, actual: null },
          2023: { budgeted: 110_000, actual: null },
          2024: { budgeted: 120_000, actual: null },
          2025: { budgeted: 130_000, actual: null },
        },
      },
      years,
    );
    assert.ok(score);
    assert.equal(score.field, "budgeted");
    assert.equal(score.pointCount, 4);
    assert.ok(Math.abs(score.score - 1) < 1e-10);
  });

  it("treats a flat series as perfectly linear", () => {
    const score = lineItemLinearity(
      {
        byYear: {
          2022: { budgeted: 42_000, actual: null },
          2023: { budgeted: 42_000, actual: null },
          2024: { budgeted: 42_000, actual: null },
        },
      },
      [2022, 2023, 2024],
    );
    assert.equal(score?.score, 1);
  });

  it("scores a nearly-flat fee with one step as highly linear", () => {
    const score = relativeLineFit([
      { x: 2021, y: 7068 },
      { x: 2022, y: 8064 },
      { x: 2023, y: 8064 },
      { x: 2024, y: 8064 },
      { x: 2025, y: 8064 },
      { x: 2026, y: 8064 },
    ]);
    assert.ok(score != null && score > 0.9);
  });

  it("scores an accelerating series lower than a near-flat one", () => {
    const accelerating = relativeLineFit([
      { x: 2021, y: 1186 },
      { x: 2022, y: 500 },
      { x: 2023, y: 3500 },
      { x: 2025, y: 17_301 },
    ]);
    const nearFlat = relativeLineFit([
      { x: 2021, y: 7068 },
      { x: 2022, y: 8064 },
      { x: 2023, y: 8064 },
      { x: 2025, y: 8064 },
    ]);
    assert.ok(accelerating != null && nearFlat != null);
    assert.ok(accelerating < 0.7);
    assert.ok(accelerating < nearFlat - 0.2);
  });

  it("scores a jumpy series much lower than a line", () => {
    const score = lineItemLinearity(
      {
        byYear: {
          2022: { budgeted: 10_000, actual: null },
          2023: { budgeted: 90_000, actual: null },
          2024: { budgeted: 12_000, actual: null },
          2025: { budgeted: 85_000, actual: null },
        },
      },
      years,
    );
    assert.ok(score);
    assert.ok(score.score < 0.6);
  });

  it("needs three points; two collinear years are not scored", () => {
    assert.equal(
      lineItemLinearity(
        {
          byYear: {
            2022: { budgeted: 1, actual: null },
            2023: { budgeted: 2, actual: null },
          },
        },
        [2022, 2023],
      ),
      null,
    );
  });

  it("falls back to actuals when budgeted has fewer than three points", () => {
    const score = lineItemLinearity(
      {
        byYear: {
          2022: { budgeted: 100, actual: 10 },
          2023: { budgeted: null, actual: 20 },
          2024: { budgeted: null, actual: 30 },
        },
      },
      [2022, 2023, 2024],
    );
    assert.equal(score?.field, "actual");
    assert.ok(score && Math.abs(score.score - 1) < 1e-10);
  });

  it("reports the worse of budgeted vs actual so a curved series is not hidden", () => {
    const score = lineItemLinearity(
      {
        byYear: {
          2022: { budgeted: 100, actual: 10 },
          2023: { budgeted: 200, actual: 20 },
          2024: { budgeted: 300, actual: 400 },
          2025: { budgeted: 400, actual: 50 },
        },
      },
      years,
    );
    assert.equal(score?.field, "actual");
    assert.ok(score && score.score < 0.85);
  });
});

const GOLDEN_2022 =
  "data/email-attachments/c69c857c51b1dc87f33df58d3bf0c20a10da02081965022982bb743274dca0fb.md";

if (existsSync(GOLDEN_2022)) {
  describe("parseBudgetMarkdown golden 2022-2023 package", () => {
    it("extracts common element fees for the budget year", () => {
      const markdown = readFileSync(GOLDEN_2022, "utf8");
      const { lines } = parseBudgetMarkdown(markdown);
      const fees = lines.find((line) => line.code === "4010");
      assert.ok(fees);
      assert.equal(
        fees.amounts.find(
          (amount) =>
            amount.fiscalYearStart === 2022 && amount.role === "budget",
        )?.value,
        2_504_737,
      );
      assert.ok(lines.length >= 40);
    });
  });
}
