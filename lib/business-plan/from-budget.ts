import type { BudgetLineItem, BudgetPageData } from "@/lib/budget/types";
import {
  SAVINGS_RATES,
  THIS_BUILDING_NAME,
  THIS_BUILDING_UNITS,
  type BusinessPlanBudgetSnapshot,
  type BusinessPlanImpact,
  type BudgetImpactId,
} from "@/lib/business-plan/content";

const CLEANING_CODES = new Set([
  "6200",
  "6210",
  "6233",
  "6235",
  "6420",
  "6440",
]);
const SECURITY_CODES = new Set(["6242", "6245", "6435"]);
const PM_CODES = new Set(["5510"]);
const RESERVE_CODES = new Set(["8510", "8511"]);
const EQUIPMENT_CONTRACT_CODES = new Set(["6110", "6170", "6172", "6222"]);

const IMPACT_ORDER: BudgetImpactId[] = [
  "cleaning",
  "security",
  "property-management",
  "equipment",
  "reserve",
];

function savingsRateFor(id: BudgetImpactId): { conservative: number; full: number } {
  if (id === "property-management") return SAVINGS_RATES.staffing;
  if (id === "equipment") {
    return {
      conservative:
        SAVINGS_RATES.equipment.conservative + SAVINGS_RATES.preventative.conservative,
      full: SAVINGS_RATES.equipment.full + SAVINGS_RATES.preventative.full,
    };
  }
  return { conservative: 0, full: 0 };
}

export function classifyBudgetLine(line: {
  code: string;
  name: string;
  category: string;
}): BudgetImpactId | null {
  const name = line.name.replace(/\s+/g, " ").trim();
  const lower = name.toLowerCase();

  if (line.code === "8520" || /deficit\s+recovery/i.test(name)) return null;

  if (CLEANING_CODES.has(line.code)) return "cleaning";
  if (/\b(housekeeping|janitorial)\b/i.test(name)) return "cleaning";
  if (/\bcleaning\b/i.test(lower) && !/\bstack\b/i.test(lower)) return "cleaning";

  if (SECURITY_CODES.has(line.code)) return "security";
  if (/\b(security|concierge)\b/i.test(lower)) return "security";

  if (PM_CODES.has(line.code) || /property\s+management/i.test(name)) {
    return "property-management";
  }

  if (
    RESERVE_CODES.has(line.code) ||
    /reserve\s+fund\s+contribution/i.test(name)
  ) {
    return "reserve";
  }

  if (EQUIPMENT_CONTRACT_CODES.has(line.code)) return "equipment";
  if (line.category === "Repairs and maintenance") return "equipment";
  if (
    line.category === "Contracts" &&
    /\b(elevators?|hvac|heat\s*pumps?|emergency\s+generator)\b/i.test(lower)
  ) {
    return "equipment";
  }

  return null;
}

export function lineAmountForYear(
  line: BudgetLineItem,
  year: number,
  field: "budgeted" | "actual",
): number | null {
  const value = line.byYear[year]?.[field];
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

export function latestBudgetedYear(data: BudgetPageData): number | null {
  const years = [...data.years].sort((a, b) => b - a);
  for (const year of years) {
    if (data.lines.some((line) => lineAmountForYear(line, year, "budgeted") != null)) {
      return year;
    }
  }
  for (const year of years) {
    if (data.lines.some((line) => lineAmountForYear(line, year, "actual") != null)) {
      return year;
    }
  }
  return null;
}

function emptyImpacts(): BusinessPlanImpact[] {
  return IMPACT_ORDER.map((id) => ({
    id,
    spendUsd: 0,
    lines: [],
    savingsRate: savingsRateFor(id),
  }));
}

export function buildBusinessPlanSnapshot(
  data: BudgetPageData,
): BusinessPlanBudgetSnapshot {
  const fiscalYearStart = latestBudgetedYear(data);
  const amountField =
    fiscalYearStart == null
      ? null
      : data.lines.some(
            (line) => lineAmountForYear(line, fiscalYearStart, "budgeted") != null,
          )
        ? "budgeted"
        : "actual";

  const impacts = emptyImpacts();
  const byId = new Map(impacts.map((impact) => [impact.id, impact]));

  if (fiscalYearStart != null && amountField != null) {
    for (const line of data.lines) {
      const id = classifyBudgetLine(line);
      if (!id) continue;
      const amount = lineAmountForYear(line, fiscalYearStart, amountField);
      if (amount == null) continue;
      const impact = byId.get(id);
      if (!impact) continue;
      impact.spendUsd += amount;
      impact.lines.push({
        code: line.code,
        name: line.name,
        amountUsd: amount,
      });
    }
  }

  for (const impact of impacts) {
    impact.lines.sort((a, b) => a.code.localeCompare(b.code));
  }

  return {
    corporation: THIS_BUILDING_NAME,
    sourceUnits: THIS_BUILDING_UNITS,
    fiscalYearStart,
    amountField,
    impacts,
  };
}
