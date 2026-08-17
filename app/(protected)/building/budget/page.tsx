export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { BudgetYoYChart } from "@/components/BudgetYoYChart";
import { loadBudgetSeries } from "@/lib/insights/load-insights-pages";

export default async function BuildingBudgetPage() {
  const budgetSeries = await loadBudgetSeries();

  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Building model
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Budget &amp; financials
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Year-over-year budgeted versus actual spend by category.
        </p>
      </div>

      <BudgetYoYChart series={budgetSeries} />
    </section>
  );
}
