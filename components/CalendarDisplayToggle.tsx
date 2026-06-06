"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  type CalendarDisplayMode,
  calendarHref,
  parseCalendarDate,
  parseCalendarDisplayMode,
  parseCalendarView,
} from "@/lib/calendar/grid";

const DISPLAY_OPTIONS: Array<{ id: CalendarDisplayMode; label: string }> = [
  { id: "calendar", label: "Calendar" },
  { id: "list", label: "List" },
];

export function CalendarDisplayToggle() {
  const searchParams = useSearchParams();
  const activeDisplay = parseCalendarDisplayMode(searchParams.get("display"));
  const view = parseCalendarView(searchParams.get("view"));
  const date = parseCalendarDate(searchParams.get("date"));

  return (
    <div
      className="flex rounded-xl border border-slate-200 bg-slate-100 p-0.5"
      role="tablist"
      aria-label="Calendar display mode"
    >
      {DISPLAY_OPTIONS.map((option) => {
        const selected = activeDisplay === option.id;

        return (
          <Link
            key={option.id}
            href={calendarHref(view, date, option.id)}
            role="tab"
            aria-selected={selected}
            className={`flex-1 rounded-lg px-4 py-1.5 text-center text-xs font-semibold transition sm:px-6 ${
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
