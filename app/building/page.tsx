export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { BuildingPageClient } from "./BuildingPageClient";
import { fetchBuildingEquipmentData } from "@/lib/building/fetch-equipment";

export default async function BuildingPage() {
  const data = await fetchBuildingEquipmentData();
  return <BuildingPageClient {...data} />;
}
