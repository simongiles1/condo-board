"use client";

import {
  clampEntityListPage,
  ENTITY_REGISTRY_PAGE_SIZE,
  entityListPageCount,
} from "@/lib/entities/registry-page";

export function EntityListPagination({
  total,
  page,
  pageSize = ENTITY_REGISTRY_PAGE_SIZE,
  pending = false,
  onPageChange,
  ariaLabel,
}: {
  total: number;
  page: number;
  pageSize?: number;
  pending?: boolean;
  onPageChange: (page: number) => void;
  ariaLabel: string;
}) {
  if (total <= pageSize) return null;

  const totalPages = entityListPageCount(total, pageSize);
  const safePage = clampEntityListPage(page, total, pageSize);
  const rangeStart = (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, total);

  return (
    <nav
      aria-label={ariaLabel}
      className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
    >
      <p>
        {rangeStart}–{rangeEnd} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending || safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <span className="flex-1 text-center text-slate-600">
          Page {safePage} of {totalPages}
        </span>
        <button
          type="button"
          disabled={pending || safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
