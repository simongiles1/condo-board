export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { budgetLineItems } from "@/lib/db/schema";

export async function GET() {
  const db = getDb();
  const rows = await db
    .select({
      fiscalYear: budgetLineItems.fiscalYear,
      categoryName: budgetLineItems.categoryName,
      budgetedAmount: budgetLineItems.budgetedAmount,
      actualAmount: budgetLineItems.actualAmount,
    })
    .from(budgetLineItems);

  const byYearCategory = new Map<
    string,
    { budgeted: number; actual: number }
  >();

  for (const row of rows) {
    const year = row.fiscalYear ?? 0;
    const key = `${year}|${row.categoryName}`;
    const current = byYearCategory.get(key) ?? { budgeted: 0, actual: 0 };
    current.budgeted += Number(row.budgetedAmount ?? 0);
    current.actual += Number(row.actualAmount ?? 0);
    byYearCategory.set(key, current);
  }

  const series = [...byYearCategory.entries()].map(([key, values]) => {
    const [yearStr, category] = key.split("|");
    return {
      fiscalYear: Number(yearStr),
      category,
      budgeted: values.budgeted,
      actual: values.actual,
    };
  });

  const years = [...new Set(series.map((s) => s.fiscalYear))].sort(
    (a, b) => a - b,
  );
  const categories = [...new Set(series.map((s) => s.category))].sort();

  return NextResponse.json({ series, years, categories });
}
