export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { BusinessPlanClient } from "@/components/BusinessPlanClient";
import { hasMinRole } from "@/lib/auth/roles";
import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";
import { loadBudgetPageData } from "@/lib/budget/load-budgets";
import { buildBusinessPlanSnapshot } from "@/lib/business-plan/from-budget";

export default async function BusinessPlanPage() {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const user = await getSessionUser();
  if (!user || !hasMinRole(user.role, "admin")) {
    redirect("/");
  }

  const budget = await loadBudgetPageData();
  const snapshot = buildBusinessPlanSnapshot(budget);

  return (
    <BusinessPlanClient
      snapshot={snapshot}
      showPricingRoi={user.role === "super_admin"}
    />
  );
}
