"use client";

import { useMemo } from "react";

import type { CalendarEventSummary } from "@/lib/calendar/event-types";
import { groupEventsByDay } from "@/lib/calendar/event-types";
import { getTodayKey } from "@/lib/calendar/grid";
import { DISPLAY_TIME_ZONE } from "@/lib/format/datetime";

type Props = {
  events: CalendarEventSummary[];
  onSelectEvent?: (eventId: string) => void;
};

function formatDayHeading(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(y, m - 1, d));
}

function formatEventTime(startAt: string): string | null {
  if (!startAt.includes("T")) return null;
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(startAt));
}

function eventTypeLabel(eventType: string): string {
  return eventType.charAt(0).toUpperCase() + eventType.slice(1);
}

export function CalendarListView({ events, onSelectEvent }: Props) {
  const todayKey = getTodayKey();
  const groups = useMemo(() => groupEventsByDay(events), [events]);

  if (!groups.length) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        No calendar events yet.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {groups.map(({ dayKey, events: dayEvents }) => {
          const isToday = dayKey === todayKey;

          return (
            <section key={dayKey}>
              <header
                className={`sticky top-0 z-10 border-b border-slate-100 px-4 py-2.5 ${
                  isToday ? "bg-teal-50" : "bg-slate-50"
                }`}
              >
                <h3
                  className={`text-sm font-semibold ${
                    isToday ? "text-teal-900" : "text-slate-900"
                  }`}
                >
                  {formatDayHeading(dayKey)}
                  {isToday ? (
                    <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-teal-700">
                      Today
                    </span>
                  ) : null}
                </h3>
              </header>
              <ul className="divide-y divide-slate-100">
                {dayEvents.map((event) => {
                  const timeLabel = formatEventTime(event.startAt);

                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => onSelectEvent?.(event.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-teal-50/50"
                      >
                        {timeLabel ? (
                          <span className="w-20 shrink-0 pt-0.5 text-xs font-medium tabular-nums text-slate-500">
                            {timeLabel}
                          </span>
                        ) : (
                          <span className="w-20 shrink-0" aria-hidden="true" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {event.title}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {eventTypeLabel(event.eventType)}
                          </span>
                          {event.description ? (
                            <span className="mt-1 block line-clamp-2 text-xs text-slate-600">
                              {event.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
