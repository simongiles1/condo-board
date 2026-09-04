export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { BuildingModelClient } from "../BuildingModelClient";
import { buildBuildingGeometry } from "@/lib/building/building-geometry";
import { buildRiserGeometry } from "@/lib/building/riser-geometry";
import { loadRegistryMapItems } from "@/lib/building/equipment-registry";
import { loadFloorPlansPayload } from "@/lib/building/floor-plans";

export default async function BuildingOverviewPage() {
  const [registryMapItems, floorPlans] = await Promise.all([
    loadRegistryMapItems(),
    loadFloorPlansPayload(),
  ]);
  const structure = buildBuildingGeometry(floorPlans);
  const risers = buildRiserGeometry(floorPlans);

  return (
    <section className="flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden">
      <div className="shrink-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Building model
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          Asset overview &amp; 3D
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Orbit the stacked architectural model and mechanical riser sweeps built
          from aligned floor-plan markup. Equipment markers from the registry stay on the same view.
        </p>
      </div>
      <BuildingModelClient
        registryMapItems={registryMapItems}
        structure={structure}
        risers={risers}
      />
    </section>
  );
}
