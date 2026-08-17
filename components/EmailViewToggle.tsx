"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  type EmailInboxView,
  buildEmailThreadSearchParams,
  parseEmailThreadFilters,
  searchParamsToFilterRecord,
} from "@/lib/email/thread-filter-params";

const VIEW_OPTIONS: Array<{ id: EmailInboxView; label: string }> = [
  { id: "messages", label: "Individual" },
  { id: "threads", label: "By thread" },
];

function viewHref(view: EmailInboxView, searchParams: URLSearchParams): string {
  const filters = parseEmailThreadFilters(searchParamsToFilterRecord(searchParams));
  const params = buildEmailThreadSearchParams({ ...filters, view, page: 1 });
  const qs = params.toString();
  return qs ? `/knowledge/emails?${qs}` : "/knowledge/emails";
}

export function EmailViewToggle() {
  const searchParams = useSearchParams();
  const activeView = parseEmailThreadFilters(
    searchParamsToFilterRecord(searchParams),
  ).view;

  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100 p-0.5"
      role="group"
      aria-label="Email list view"
    >
      {VIEW_OPTIONS.map((option) => {
        const selected = activeView === option.id;

        return (
          <Link
            key={option.id}
            href={viewHref(option.id, searchParams)}
            aria-current={selected ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
