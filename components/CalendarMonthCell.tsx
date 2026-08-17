"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CalendarDay } from "@/lib/calendar/grid";
import {
  calendarEventAppearance,
  type CalendarEventSummary,
} from "@/lib/calendar/event-types";

const EVENT_ROW_HEIGHT = 18;
const EVENT_GAP = 4;
const DAY_NUMBER_BLOCK = 22;
const CELL_PADDING = 12;
const MORE_LINK_HEIGHT = 16;

function visibleEventCount(cellHeight: number, totalEvents: number): number {
  if (totalEvents === 0) return 0;

  let available = cellHeight - DAY_NUMBER_BLOCK - CELL_PADDING;
  const rowBlock = EVENT_ROW_HEIGHT + EVENT_GAP;

  const allFit =
    totalEvents * EVENT_ROW_HEIGHT + (totalEvents - 1) * EVENT_GAP <= available;
  if (allFit) return totalEvents;

  available -= MORE_LINK_HEIGHT;
  const count = Math.floor((available + EVENT_GAP) / rowBlock);
  return Math.max(0, Math.min(count, totalEvents));
}

type Props = {
  day: CalendarDay;
  events: CalendarEventSummary[];
  onSelectEvent?: (eventId: string) => void;
};

export function CalendarMonthCell({ day, events, onSelectEvent }: Props) {
  const cellRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(events.length);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  useEffect(() => {
    const cell = cellRef.current;
    if (!cell) return;

    const update = () => {
      setVisibleCount(visibleEventCount(cell.clientHeight, events.length));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [events.length]);

  const hiddenCount = events.length - visibleCount;
  const visibleEvents = events.slice(0, visibleCount);
  const hiddenEvents = events.slice(visibleCount);

  const openPopover = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const anchor = moreRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 4, left: rect.left });
    setPopoverOpen(true);
  };

  const closePopover = () => {
    hideTimerRef.current = window.setTimeout(() => {
      setPopoverOpen(false);
      setPopoverPos(null);
      hideTimerRef.current = null;
    }, 120);
  };

  return (
    <div
      ref={cellRef}
      className={`flex min-h-0 flex-col border-b border-r border-slate-100 p-1.5 last:border-r-0 nth-[7n]:border-r-0 ${
        day.isCurrentMonth ? "bg-white" : "bg-slate-50/80"
      }`}
    >
      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          day.isToday
            ? "bg-teal-700 text-white"
            : day.isCurrentMonth
              ? "text-slate-900"
              : "text-slate-400"
        }`}
      >
        {day.dayNumber}
      </span>
      <div className="mt-0.5 min-h-0 flex-1 space-y-0.5 overflow-hidden">
        {visibleEvents.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelectEvent?.(event.id)}
            className={`block w-full truncate rounded-r border-l-2 px-1.5 py-0.5 text-left text-[10px] font-medium transition ${calendarEventAppearance(event.eventType).chip}`}
            title={event.title}
          >
            {event.title}
          </button>
        ))}
        {hiddenCount > 0 ? (
          <div
            onMouseEnter={openPopover}
            onMouseLeave={closePopover}
          >
            <button
              ref={moreRef}
              type="button"
              className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold text-teal-700 transition hover:bg-teal-50"
            >
              +{hiddenCount} more
            </button>
            {popoverOpen && popoverPos
              ? createPortal(
                  <div
                    className="fixed z-50 min-w-[10rem] max-w-[14rem] rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
                    style={{ top: popoverPos.top, left: popoverPos.left }}
                    onMouseEnter={openPopover}
                    onMouseLeave={closePopover}
                  >
                    {hiddenEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onSelectEvent?.(event.id)}
                        className={`block w-full truncate rounded-r border-l-2 px-1.5 py-1 text-left text-[11px] font-medium transition ${calendarEventAppearance(event.eventType).chip}`}
                        title={event.title}
                      >
                        {event.title}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )
              : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
