"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import type { CalendarEventSummary } from "@/lib/calendar/event-types";

import { CalendarEventDetailDialog } from "@/components/CalendarEventDetailDialog";
import { CalendarMonthGrid } from "@/components/CalendarMonthGrid";
import { CalendarViewToggle } from "@/components/CalendarViewToggle";
import { CalendarWeekGrid } from "@/components/CalendarWeekGrid";
import {
  calendarHref,
  formatMonthTitle,
  formatWeekTitle,
  getTodayKey,
  parseCalendarDate,
  parseCalendarView,
  shiftCalendarDate,
} from "@/lib/calendar/grid";

export function CalendarPageClient({
  events = [],
}: {
  events?: CalendarEventSummary[];
}) {
  const searchParams = useSearchParams();
  const view = parseCalendarView(searchParams.get("view"));
  const date = parseCalendarDate(searchParams.get("date"));
  const todayKey = getTodayKey();
  const title = view === "month" ? formatMonthTitle(date) : formatWeekTitle(date);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={calendarHref(view, shiftCalendarDate(date, view, "prev"))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:text-teal-800"
            aria-label={`Previous ${view}`}
          >
            ←
          </Link>
          <h2 className="min-w-36 text-center text-sm font-semibold text-slate-900">
            {title}
          </h2>
          <Link
            href={calendarHref(view, shiftCalendarDate(date, view, "next"))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:text-teal-800"
            aria-label={`Next ${view}`}
          >
            →
          </Link>
          {date !== todayKey ? (
            <Link
              href={calendarHref(view, todayKey)}
              className="ml-0.5 text-xs font-semibold text-teal-700 hover:text-teal-900"
            >
              Today
            </Link>
          ) : null}
        </div>

        <CalendarViewToggle />
      </div>

      <div className="min-h-0 flex-1">
        {view === "month" ? (
          <CalendarMonthGrid
            anchorDate={date}
            events={events}
            onSelectEvent={setSelectedEventId}
          />
        ) : (
          <CalendarWeekGrid anchorDate={date} />
        )}
      </div>

      <CalendarEventDetailDialog
        eventId={selectedEventId}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  );
}
