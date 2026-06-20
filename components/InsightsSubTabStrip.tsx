"use client";

type SubTab = {
  id: string;
  label: string;
};

type Props<T extends string> = {
  tabs: SubTab[];
  active: T;
  onChange: (tab: T) => void;
  counts?: Partial<Record<T, number>>;
  ariaLabel: string;
};

export function InsightsSubTabStrip<T extends string>({
  tabs,
  active,
  onChange,
  counts,
  ariaLabel,
}: Props<T>) {
  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5"
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        const count = counts?.[tab.id as T];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? -1 : 0}
            onClick={() => {
              if (!selected) onChange(tab.id as T);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              selected
                ? "bg-slate-100 text-slate-900 ring-1 ring-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
            {count !== undefined && count > 0 ? (
              <span className="ml-1 text-xs text-slate-500">({count})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
