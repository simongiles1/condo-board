"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import type { CalendarEventSummary } from "@/lib/calendar/event-types";

import { CalendarDisplayToggle } from "@/components/CalendarDisplayToggle";
import { CalendarEventDetailDialog } from "@/components/CalendarEventDetailDialog";
import { CalendarListView } from "@/components/CalendarListView";
import { CalendarMonthGrid } from "@/components/CalendarMonthGrid";
import { CalendarViewToggle } from "@/components/CalendarViewToggle";
import { CalendarWeekGrid } from "@/components/CalendarWeekGrid";
import {
  calendarHref,
  formatMonthTitle,
  formatWeekTitle,
  getTodayKey,
  parseCalendarDate,
  parseCalendarDisplayMode,
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
  const display = parseCalendarDisplayMode(searchParams.get("display"));
  const date = parseCalendarDate(searchParams.get("date"));
  const todayKey = getTodayKey();
  const title = view === "month" ? formatMonthTitle(date) : formatWeekTitle(date);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const isCalendarDisplay = display === "calendar";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <CalendarDisplayToggle />

      {isCalendarDisplay ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={calendarHref(
                view,
                shiftCalendarDate(date, view, "prev"),
                display,
              )}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:text-teal-800"
              aria-label={`Previous ${view}`}
            >
              ←
            </Link>
            <h2 className="min-w-36 text-center text-sm font-semibold text-slate-900">
              {title}
            </h2>
            <Link
              href={calendarHref(
                view,
                shiftCalendarDate(date, view, "next"),
                display,
              )}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:text-teal-800"
              aria-label={`Next ${view}`}
            >
              →
            </Link>
            {date !== todayKey ? (
              <Link
                href={calendarHref(view, todayKey, display)}
                className="ml-0.5 text-xs font-semibold text-teal-700 hover:text-teal-900"
              >
                Today
              </Link>
            ) : null}
          </div>

          <CalendarViewToggle />
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {display === "list" ? (
          <CalendarListView
            events={events}
            onSelectEvent={setSelectedEventId}
          />
        ) : view === "month" ? (
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
