"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type BudgetPoint = {
  fiscalYear: number;
  category: string;
  budgeted: number;
  actual: number;
};

export function BudgetYoYChart({ series }: { series: BudgetPoint[] }) {
  const byYear = new Map<number, Record<string, number>>();
  for (const row of series) {
    const yearRow = byYear.get(row.fiscalYear) ?? { year: row.fiscalYear };
    yearRow[`${row.category} (actual)`] =
      (yearRow[`${row.category} (actual)`] ?? 0) + row.actual;
    byYear.set(row.fiscalYear, yearRow);
  }

  const data = [...byYear.values()].sort(
    (a, b) => Number(a.year) - Number(b.year),
  );

  if (!data.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        No budget data yet. Analyze emails with financial attachments to populate this chart.
      </p>
    );
  }

  const categories = [
    ...new Set(series.map((s) => `${s.category} (actual)`)),
  ].slice(0, 8);

  const colors = [
    "#0f766e",
    "#0369a1",
    "#7c3aed",
    "#c2410c",
    "#be123c",
    "#4d7c0f",
    "#a16207",
    "#475569",
  ];

  return (
    <div className="h-96 w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" />
          <YAxis />
          <Tooltip />
          <Legend />
          {categories.map((category, index) => (
            <Bar
              key={category}
              dataKey={category}
              fill={colors[index % colors.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
