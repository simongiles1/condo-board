"use client";

import {
  ALL_EQUIPMENT_CATEGORIES,
  EQUIPMENT,
  EQUIPMENT_CATEGORIES,
  type EquipmentCategory,
} from "@/lib/building/fixtures";

type EquipmentLegendProps = {
  visibleCategories: Set<EquipmentCategory>;
  onToggleCategory: (category: EquipmentCategory) => void;
};

export function EquipmentLegend({
  visibleCategories,
  onToggleCategory,
}: EquipmentLegendProps) {
  const counts = ALL_EQUIPMENT_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = EQUIPMENT.filter((item) => item.category === category).length;
      return acc;
    },
    {} as Record<EquipmentCategory, number>,
  );

  return (
    <aside className="absolute right-3 top-3 z-10 w-52 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Equipment
      </p>
      <ul className="mt-2 space-y-1.5">
        {ALL_EQUIPMENT_CATEGORIES.map((category) => {
          const meta = EQUIPMENT_CATEGORIES[category];
          const active = visibleCategories.has(category);
          return (
            <li key={category}>
              <button
                type="button"
                onClick={() => onToggleCategory(category)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                  active
                    ? "bg-slate-50 text-slate-900"
                    : "text-slate-400 line-through opacity-60"
                }`}
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full shadow-sm"
                  style={{
                    backgroundColor: meta.color,
                    boxShadow: active ? `0 0 6px ${meta.color}` : undefined,
                  }}
                  aria-hidden
                />
                <span className="flex-1">{meta.label}</span>
                <span className="tabular-nums text-xs text-slate-500">
                  {counts[category]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Click a category to show or hide markers. Drag to orbit; scroll to zoom.
      </p>
    </aside>
  );
}
