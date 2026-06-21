export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { BuildingPageClient } from "./BuildingPageClient";
import { fetchBuildingEquipmentData } from "@/lib/building/fetch-equipment";
import { loadRegistryMapItems } from "@/lib/building/equipment-registry";

export default async function BuildingPage() {
  const [data, registryMapItems] = await Promise.all([
    fetchBuildingEquipmentData(),
    loadRegistryMapItems(),
  ]);
  return (
    <BuildingPageClient {...data} registryMapItems={registryMapItems} />
  );
}
