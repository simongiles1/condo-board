export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { InsightsQueueClient } from "@/components/InsightsQueueClient";
import { loadInsightsQueueData } from "@/lib/insights/load-insights-pages";

export default async function InsightsQueuePage() {
  const data = await loadInsightsQueueData();
  return <InsightsQueueClient {...data} />;
}
