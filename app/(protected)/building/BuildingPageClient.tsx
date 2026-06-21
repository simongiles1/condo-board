"use client";

import { useState } from "react";

import { BuildingModelClient } from "./BuildingModelClient";
import { BuildingTabStrip, type BuildingTabId } from "@/components/building/BuildingTabStrip";
import { EquipmentTable } from "@/components/building/EquipmentTable";
import type { BuildingEquipmentData } from "@/lib/building/fetch-equipment";
import type { RegistryMapItem } from "@/lib/building/equipment-registry";

type BuildingPageClientProps = BuildingEquipmentData & {
  registryMapItems: RegistryMapItem[];
};

export function BuildingPageClient({
  events,
  assets,
  registryMapItems,
}: BuildingPageClientProps) {
  const [activeTab, setActiveTab] = useState<BuildingTabId>("render");

  return (
    <section className="flex min-h-0 flex-1 flex-col space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Building model
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Building</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Explore equipment in a 3D proof-of-concept render, or review extracted
          maintenance history from analyzed emails in table view.
        </p>
      </div>

      <BuildingTabStrip active={activeTab} onChange={setActiveTab} />

      {activeTab === "render" ? (
        <BuildingModelClient registryMapItems={registryMapItems} />
      ) : (
        <EquipmentTable events={events} assets={assets} />
      )}
    </section>
  );
}
