"use client";

type TabId = "minutes" | "todos";

type Tab = {
  id: TabId;
  label: string;
};

const TABS: Tab[] = [
  { id: "minutes", label: "Meeting minutes" },
  { id: "todos", label: "To-dos" },
];

type Props = {
  active: TabId;
  onChange: (tab: TabId) => void;
};

export function ContentTabStrip({ active, onChange }: Props) {
  return (
    <div
      className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Meeting content"
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

export type { TabId };
