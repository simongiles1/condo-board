"use client";

export type BuildingTabId = "render" | "table";

type Tab = {
  id: BuildingTabId;
  label: string;
};

const TABS: Tab[] = [
  { id: "render", label: "3D render" },
  { id: "table", label: "Table view" },
];

type Props = {
  active: BuildingTabId;
  onChange: (tab: BuildingTabId) => void;
};

export function BuildingTabStrip({ active, onChange }: Props) {
  return (
    <div
      className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Building views"
    >
      {TABS.map((tab) => {
        const selected = active === tab.id;
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
          </button>
        );
      })}
    </div>
  );
}
