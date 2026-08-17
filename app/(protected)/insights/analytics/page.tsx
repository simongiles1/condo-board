export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { InsightsAnalyticsClient } from "@/components/InsightsAnalyticsClient";
import {
  loadMaintenanceEventsWithSources,
  loadOpenActionItems,
} from "@/lib/insights/load-insights-pages";

export default async function InsightsAnalyticsPage() {
  const [events, actionItems] = await Promise.all([
    loadMaintenanceEventsWithSources(),
    loadOpenActionItems(),
  ]);
  return (
    <InsightsAnalyticsClient events={events} actionItems={actionItems} />
  );
}
