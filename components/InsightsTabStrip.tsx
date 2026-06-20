"use client";

export type InsightsTabId =
  | "entities"
  | "contacts"
  | "equipment"
  | "budget"
  | "approved-organizations"
  | "action-items";

type Tab = {
  id: InsightsTabId;
  label: string;
};

const TABS: Tab[] = [
  { id: "entities", label: "Unapproved entities" },
  { id: "contacts", label: "Contacts" },
  { id: "equipment", label: "Equipment" },
  { id: "budget", label: "Budget" },
  { id: "approved-organizations", label: "Organizations" },
  { id: "action-items", label: "Action items" },
];

type Props = {
  active: InsightsTabId;
  onChange: (tab: InsightsTabId) => void;
  counts: Partial<Record<InsightsTabId, number>>;
};

export function InsightsTabStrip({ active, onChange, counts }: Props) {
  return (
    <div
      className="inline-flex max-w-full flex-wrap rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Insights sections"
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
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
            {count !== undefined && count > 0 ? (
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

export { TABS as INSIGHTS_TABS };
