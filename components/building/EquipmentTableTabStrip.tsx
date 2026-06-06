"use client";

export type EquipmentTableTabId = "assets" | "events";

type Tab = {
  id: EquipmentTableTabId;
  label: string;
};

const TABS: Tab[] = [
  { id: "assets", label: "Assets" },
  { id: "events", label: "Events" },
];

type Props = {
  active: EquipmentTableTabId;
  onChange: (tab: EquipmentTableTabId) => void;
  counts: Record<EquipmentTableTabId, number>;
};

export function EquipmentTableTabStrip({ active, onChange, counts }: Props) {
  return (
    <div
      className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Equipment table"
    >
      {TABS.map((tab) => {
        const selected = active === tab.id;
        const count = counts[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? -1 : 0}
            onClick={() => {
              if (!selected) onChange(tab.id);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
            {count > 0 ? (
              <span className="ml-1.5 text-xs font-medium text-slate-500">
                ({count})
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
