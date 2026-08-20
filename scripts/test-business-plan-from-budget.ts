/**
 * Ground the business-plan ROI model in this building's operating-budget GL.
 * Run: npx tsx --test scripts/test-business-plan-from-budget.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BudgetLineItem, BudgetPageData } from "../lib/budget/types";
import {
  SAVINGS_RATES,
  THIS_BUILDING_UNITS,
  scaleFromThisBuilding,
  tierValueUsd,
  totalValueUsd,
} from "../lib/business-plan/content";
import {
  buildBusinessPlanSnapshot,
  classifyBudgetLine,
  latestBudgetedYear,
  lineAmountForYear,
} from "../lib/business-plan/from-budget";

function line(
  code: string,
  name: string,
  category: string,
  byYear: BudgetLineItem["byYear"],
): BudgetLineItem {
  return { code, name, category, byYear };
}

const SAMPLE_2026: BudgetPageData = {
  years: [2025, 2026],
  documents: [],
  lines: [
    line("5510", "Property Management Fees", "Administration", {
      2025: { budgeted: 150_504, actual: 156_000 },
      2026: { budgeted: 160_000, actual: null },
    }),
    line("6210", "Housekeeping/ Janitorial", "Contracts", {
      2026: { budgeted: 190_000, actual: null },
    }),
    line("6200", "Window Cleaning", "Contracts", {
      2026: { budgeted: 24_000, actual: null },
    }),
    line("6533", "Plumbing - Stack Cleaning", "Repairs and maintenance", {
      2026: { budgeted: 33_000, actual: null },
    }),
    line("6242", "Security Services - Concierge", "Contracts", {
      2026: { budgeted: 250_000, actual: null },
    }),
    line("6245", "Security Escorts", "Contracts", {
      2026: { budgeted: 6_000, actual: null },
    }),
    line("6510", "Boiler Repairs", "Repairs and maintenance", {
      2026: { budgeted: 12_000, actual: null },
    }),
    line("6545", "Motors and Pumps", "Repairs and maintenance", {
      2026: { budgeted: 8_000, actual: null },
    }),
    line("6170", "HVAC Maintenance", "Contracts", {
      2026: { budgeted: 22_000, actual: null },
    }),
    line("6110", "Elevators", "Contracts", {
      2026: { budgeted: 48_000, actual: null },
    }),
    line("8510", "Reserve Fund Contribution", "Reserve fund", {
      2026: { budgeted: 700_000, actual: null },
    }),
    line("8511", "Reserve Fund Contribution - Shared Facilities", "Reserve fund", {
      2026: { budgeted: 55_000, actual: null },
    }),
    line("8520", "Deficit Recovery", "Reserve fund", {
      2026: { budgeted: 10_000, actual: null },
    }),
    line("6011", "Steam Heat", "Utilities", {
      2026: { budgeted: 320_000, actual: null },
    }),
  ],
};

describe("THIS_BUILDING_UNITS", () => {
  it("is 333 — Studio on Richmond / TSCC 2517", () => {
    assert.equal(THIS_BUILDING_UNITS, 333);
  });
});

describe("classifyBudgetLine", () => {
  it("maps janitorial and window cleaning to cleaning, not stack cleaning", () => {
    assert.equal(
      classifyBudgetLine({
        code: "6210",
        name: "Housekeeping/ Janitorial",
        category: "Contracts",
      }),
      "cleaning",
    );
    assert.equal(
      classifyBudgetLine({
        code: "6200",
        name: "Window Cleaning",
        category: "Contracts",
      }),
      "cleaning",
    );
    assert.equal(
      classifyBudgetLine({
        code: "6533",
        name: "Plumbing - Stack Cleaning",
        category: "Repairs and maintenance",
      }),
      "equipment",
    );
  });

  it("maps concierge and escorts to security", () => {
    assert.equal(
      classifyBudgetLine({
        code: "6242",
        name: "Security Services - Concierge",
        category: "Contracts",
      }),
      "security",
    );
  });

  it("maps property management fees to property-management", () => {
    assert.equal(
      classifyBudgetLine({
        code: "5510",
        name: "Property Management Fees",
        category: "Administration",
      }),
      "property-management",
    );
  });

  it("maps R&M and HVAC/elevator contracts to equipment", () => {
    assert.equal(
      classifyBudgetLine({
        code: "6510",
        name: "Boiler Repairs",
        category: "Repairs and maintenance",
      }),
      "equipment",
    );
    assert.equal(
      classifyBudgetLine({
        code: "6170",
        name: "HVAC Maintenance",
        category: "Contracts",
      }),
      "equipment",
    );
  });

  it("maps reserve contributions, not deficit recovery", () => {
    assert.equal(
      classifyBudgetLine({
        code: "8510",
        name: "Reserve Fund Contribution",
        category: "Reserve fund",
      }),
      "reserve",
    );
    assert.equal(
      classifyBudgetLine({
        code: "8520",
        name: "Deficit Recovery",
        category: "Reserve fund",
      }),
      null,
    );
  });

  it("ignores utilities", () => {
    assert.equal(
      classifyBudgetLine({
        code: "6011",
        name: "Steam Heat",
        category: "Utilities",
      }),
      null,
    );
  });
});

describe("latestBudgetedYear", () => {
  it("picks the newest year that has a budgeted amount", () => {
    assert.equal(latestBudgetedYear(SAMPLE_2026), 2026);
  });

  it("falls back to actuals when no budgeted year exists", () => {
    const data: BudgetPageData = {
      years: [2024],
      documents: [],
      lines: [
        line("5510", "Property Management Fees", "Administration", {
          2024: { budgeted: null, actual: 149_000 },
        }),
      ],
    };
    assert.equal(latestBudgetedYear(data), 2024);
  });
});

describe("buildBusinessPlanSnapshot", () => {
  it("sums this building's latest-year GL spend into the five operating buckets", () => {
    const snapshot = buildBusinessPlanSnapshot(SAMPLE_2026);
    assert.equal(snapshot.fiscalYearStart, 2026);
    assert.equal(snapshot.sourceUnits, 333);
    assert.equal(snapshot.amountField, "budgeted");

    const byId = Object.fromEntries(
      snapshot.impacts.map((impact) => [impact.id, impact.spendUsd]),
    );
    assert.equal(byId.cleaning, 214_000);
    assert.equal(byId.security, 256_000);
    assert.equal(byId["property-management"], 160_000);
    assert.equal(byId.equipment, 123_000);
    assert.equal(byId.reserve, 755_000);
  });

  it("does not treat stack cleaning as janitorial spend", () => {
    const snapshot = buildBusinessPlanSnapshot(SAMPLE_2026);
    const cleaning = snapshot.impacts.find((impact) => impact.id === "cleaning");
    assert.ok(cleaning);
    assert.equal(
      cleaning.lines.some((item) => item.code === "6533"),
      false,
    );
    const equipment = snapshot.impacts.find((impact) => impact.id === "equipment");
    assert.ok(equipment?.lines.some((item) => item.code === "6533"));
  });
});

describe("ROI applied to this building's spend", () => {
  it("takes 10% / 20% of actual PM fees, not the memo's generic $15–30k", () => {
    const snapshot = buildBusinessPlanSnapshot(SAMPLE_2026);
    assert.equal(
      tierValueUsd("staffing", "conservative", THIS_BUILDING_UNITS, snapshot),
      Math.round(160_000 * SAVINGS_RATES.staffing.conservative),
    );
    assert.equal(
      tierValueUsd("staffing", "full", THIS_BUILDING_UNITS, snapshot),
      Math.round(160_000 * SAVINGS_RATES.staffing.full),
    );
  });

  it("keeps equipment + preventative inside the documented 15–35% band of equipment spend", () => {
    const snapshot = buildBusinessPlanSnapshot(SAMPLE_2026);
    const equipmentSpend = 123_000;
    const conservative =
      tierValueUsd("equipment", "conservative", THIS_BUILDING_UNITS, snapshot) +
      tierValueUsd("preventative", "conservative", THIS_BUILDING_UNITS, snapshot);
    const full =
      tierValueUsd("equipment", "full", THIS_BUILDING_UNITS, snapshot) +
      tierValueUsd("preventative", "full", THIS_BUILDING_UNITS, snapshot);
    assert.equal(
      conservative,
      Math.round(equipmentSpend * 0.2),
    );
    assert.equal(full, Math.round(equipmentSpend * 0.35));
  });

  it("treats reserve-study savings as consulting dollars, not a cut to the contribution", () => {
    const snapshot = buildBusinessPlanSnapshot(SAMPLE_2026);
    assert.equal(
      tierValueUsd("reserve", "conservative", THIS_BUILDING_UNITS, snapshot),
      SAVINGS_RATES.reserveConsultingUsd.conservative,
    );
    assert.equal(
      tierValueUsd("reserve", "full", THIS_BUILDING_UNITS, snapshot),
      SAVINGS_RATES.reserveConsultingUsd.full,
    );
  });

  it("scales linearly from this building's 333 units", () => {
    assert.equal(scaleFromThisBuilding(333), 1);
    assert.equal(scaleFromThisBuilding(666), 2);
    const snapshot = buildBusinessPlanSnapshot(SAMPLE_2026);
    const atHome = totalValueUsd("full", 333, snapshot);
    const doubled = totalValueUsd("full", 666, snapshot);
    assert.equal(doubled, atHome * 2);
  });

  it("claims $0 hard savings on cleaning and security even when spend is large", () => {
    const snapshot = buildBusinessPlanSnapshot(SAMPLE_2026);
    const cleaning = snapshot.impacts.find((impact) => impact.id === "cleaning");
    const security = snapshot.impacts.find((impact) => impact.id === "security");
    assert.ok((cleaning?.spendUsd ?? 0) > 0);
    assert.ok((security?.spendUsd ?? 0) > 0);
    assert.equal(cleaning?.savingsRate.full, 0);
    assert.equal(security?.savingsRate.full, 0);
  });
});

describe("lineAmountForYear", () => {
  it("prefers budgeted, then actual", () => {
    const item = line("5510", "Property Management Fees", "Administration", {
      2025: { budgeted: 10, actual: 99 },
      2024: { budgeted: null, actual: 7 },
    });
    assert.equal(lineAmountForYear(item, 2025, "budgeted"), 10);
    assert.equal(lineAmountForYear(item, 2024, "actual"), 7);
  });
});
