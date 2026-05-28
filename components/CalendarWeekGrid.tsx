"use client";

import { useEffect, useRef } from "react";

import {
  type CalendarDay,
  WEEKDAY_LABELS,
  WEEK_HOUR_HEIGHT_PX,
  WEEK_VIEW_HOURS,
  buildWeekDays,
  formatWeekHourLabel,
} from "@/lib/calendar/grid";

type Props = {
  anchorDate: string;
};

const TIME_GUTTER_WIDTH = "3.5rem";
const GRID_HEIGHT = WEEK_VIEW_HOURS.length * WEEK_HOUR_HEIGHT_PX;

export function CalendarWeekGrid({ anchorDate }: Props) {
  const days = buildWeekDays(anchorDate);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = 7 * WEEK_HOUR_HEIGHT_PX;
  }, [anchorDate]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div
        className="grid shrink-0 border-b border-slate-200 bg-slate-50"
        style={{ gridTemplateColumns: `${TIME_GUTTER_WIDTH} 1fr` }}
      >
        <div aria-hidden="true" />
        <div className="grid grid-cols-7">
          {days.map((day, index) => (
            <div
              key={day.key}
              className="border-r border-slate-200 px-2 py-3 text-center last:border-r-0"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {WEEKDAY_LABELS[index]}
              </p>
              <p
                className={`mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  day.isToday
                    ? "bg-teal-700 text-white"
                    : "text-slate-900"
                }`}
              >
                {day.dayNumber}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: `${TIME_GUTTER_WIDTH} 1fr` }}
        >
          <div
            className="relative border-r border-slate-200 bg-slate-50"
            style={{ height: GRID_HEIGHT }}
          >
            {WEEK_VIEW_HOURS.map((hour) => (
              <div
                key={hour}
                className="relative border-b border-slate-100"
                style={{ height: WEEK_HOUR_HEIGHT_PX }}
              >
                <span className="absolute -top-2.5 right-2 text-[11px] font-medium tabular-nums text-slate-500">
                  {formatWeekHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          <div
            className="grid grid-cols-7"
            style={{ height: GRID_HEIGHT }}
          >
            {days.map((day) => (
              <WeekDayColumn key={day.key} day={day} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekDayColumn({ day }: { day: CalendarDay }) {
  return (
    <div
      className={`relative border-r border-slate-100 last:border-r-0 ${
        day.isToday ? "bg-teal-50/30" : "bg-white"
      }`}
    >
      {WEEK_VIEW_HOURS.map((hour) => (
        <div
          key={hour}
          className="border-b border-slate-100"
          style={{ height: WEEK_HOUR_HEIGHT_PX }}
        />
      ))}
    </div>
  );
}
