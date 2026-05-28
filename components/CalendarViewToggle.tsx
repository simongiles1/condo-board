"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  type CalendarView,
  calendarHref,
  parseCalendarDate,
  parseCalendarView,
} from "@/lib/calendar/grid";

const VIEW_OPTIONS: Array<{ id: CalendarView; label: string }> = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
];

export function CalendarViewToggle() {
  const searchParams = useSearchParams();
  const activeView = parseCalendarView(searchParams.get("view"));
  const date = parseCalendarDate(searchParams.get("date"));

  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5"
      role="tablist"
      aria-label="Calendar view"
    >
      {VIEW_OPTIONS.map((option) => {
        const selected = activeView === option.id;

        return (
          <Link
            key={option.id}
            href={calendarHref(option.id, date)}
            role="tab"
            aria-selected={selected}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
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
