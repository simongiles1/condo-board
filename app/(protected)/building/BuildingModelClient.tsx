"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { EquipmentLegend } from "@/components/building/EquipmentLegend";
import {
  ALL_EQUIPMENT_CATEGORIES,
  type EquipmentCategory,
  type EquipmentItem,
} from "@/lib/building/fixtures";
import type { RegistryMapItem } from "@/lib/building/equipment-registry";

const BuildingScene = dynamic(
  () =>
    import("@/components/building/BuildingScene").then(
      (mod) => mod.BuildingScene,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-slate-900 text-sm text-slate-400">
        Loading 3D view…
      </div>
    ),
  },
);

function registryItemsToEquipment(items: RegistryMapItem[]): EquipmentItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    floor: item.floor,
    position: item.position,
  }));
}

export function BuildingModelClient({
  registryMapItems = [],
}: {
  registryMapItems?: RegistryMapItem[];
}) {
  const [visibleCategories, setVisibleCategories] = useState<
    Set<EquipmentCategory>
  >(() => new Set(ALL_EQUIPMENT_CATEGORIES));

  const handleToggleCategory = useCallback((category: EquipmentCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
      <BuildingScene
        visibleCategories={visibleCategories}
        equipment={
          registryMapItems.length > 0
            ? registryItemsToEquipment(registryMapItems)
            : undefined
        }
      />
      <EquipmentLegend
        visibleCategories={visibleCategories}
        onToggleCategory={handleToggleCategory}
      />
    </div>
  );
}
