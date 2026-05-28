"use client";

import {
  FILE_CATEGORY_LABELS,
  FILE_CATEGORY_ORDER,
  type FileCategory,
} from "@/lib/email/file-categories";

type Props = {
  active: FileCategory;
  onChange: (tab: FileCategory) => void;
  counts: Record<FileCategory, number>;
};

export function FilesTabStrip({ active, onChange, counts }: Props) {
  return (
    <div
      className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="File categories"
    >
      {FILE_CATEGORY_ORDER.map((category) => {
        const selected = active === category;
        const count = counts[category];
        return (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? -1 : 0}
            onClick={() => {
              if (!selected) onChange(category);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {FILE_CATEGORY_LABELS[category]}
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
