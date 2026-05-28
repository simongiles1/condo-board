import {
  WEEKDAY_LABELS,
  buildMonthGrid,
} from "@/lib/calendar/grid";
import type { CalendarEventSummary } from "@/lib/calendar/event-types";
import { eventsForDay } from "@/lib/calendar/event-types";

import { CalendarMonthCell } from "@/components/CalendarMonthCell";

type Props = {
  anchorDate: string;
  events?: CalendarEventSummary[];
  onSelectEvent?: (eventId: string) => void;
};

export function CalendarMonthGrid({
  anchorDate,
  events = [],
  onSelectEvent,
}: Props) {
  const days = buildMonthGrid(anchorDate);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid shrink-0 grid-cols-7 border-b border-slate-200 bg-slate-50">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => (
          <CalendarMonthCell
            key={day.key}
            day={day}
            events={eventsForDay(events, day.key)}
            onSelectEvent={onSelectEvent}
          />
        ))}
      </div>
    </div>
  );
}
