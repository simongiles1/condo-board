export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { BuildingBudgetClient } from "./BuildingBudgetClient";
import { loadBudgetPageData } from "@/lib/budget/load-budgets";

export default async function BuildingBudgetPage() {
  const data = await loadBudgetPageData();

  return <BuildingBudgetClient data={data} />;
}
