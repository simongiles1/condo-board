export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { BuildingModelClient } from "../BuildingModelClient";
import { loadRegistryMapItems } from "@/lib/building/equipment-registry";

export default async function BuildingOverviewPage() {
  const registryMapItems = await loadRegistryMapItems();

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
          Explore equipment placement in a 3D proof-of-concept building render.
        </p>
      </div>
      <BuildingModelClient registryMapItems={registryMapItems} />
    </section>
  );
}
