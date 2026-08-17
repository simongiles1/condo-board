export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { BuildingMaintenanceClient } from "./BuildingMaintenanceClient";
import { fetchBuildingEquipmentData } from "@/lib/building/fetch-equipment";
import { loadMaintenanceEventsWithSources } from "@/lib/insights/load-insights-pages";

export default async function BuildingMaintenancePage() {
  const [tableData, timelineEvents] = await Promise.all([
    fetchBuildingEquipmentData(),
    loadMaintenanceEventsWithSources(),
  ]);

  return (
    <BuildingMaintenanceClient
      tableData={tableData}
      timelineEvents={timelineEvents}
    />
  );
}
