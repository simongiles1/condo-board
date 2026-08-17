export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { InsightsAuditClient } from "@/components/InsightsAuditClient";
import {
  loadMaintenanceEventsWithSources,
  loadOpenActionItems,
} from "@/lib/insights/load-insights-pages";

export default async function InsightsAuditPage() {
  const [events, actionItems] = await Promise.all([
    loadMaintenanceEventsWithSources(),
    loadOpenActionItems(),
  ]);
  return <InsightsAuditClient events={events} actionItems={actionItems} />;
}
