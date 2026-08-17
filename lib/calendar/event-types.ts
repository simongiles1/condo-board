export type CalendarEventSummary = {
  id: string;
  title: string;
  eventType: string;
  startAt: string;
  description: string | null;
};

/** Persisted calendar row kinds — not harvest lifecycle (cancel / moved). */
export const CALENDAR_EVENT_TYPES = [
  "meeting",
  "inspection",
  "maintenance",
  "deadline",
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export function isCalendarEventType(value: string): value is CalendarEventType {
  return (CALENDAR_EVENT_TYPES as readonly string[]).includes(value);
}

export const CALENDAR_EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  meeting: "Meeting",
  inspection: "Inspection",
  maintenance: "Maintenance",
  deadline: "Deadline",
};

type CalendarEventAppearance = {
  chip: string;
  badge: string;
  swatch: string;
};

const EVENT_APPEARANCE: Record<CalendarEventType, CalendarEventAppearance> = {
  meeting: {
    chip: "border-sky-400 bg-sky-50 text-sky-900 hover:bg-sky-100",
    badge: "bg-sky-50 text-sky-800 ring-sky-200",
    swatch: "bg-sky-400",
  },
  inspection: {
    chip: "border-teal-500 bg-teal-50 text-teal-900 hover:bg-teal-100",
    badge: "bg-teal-50 text-teal-800 ring-teal-200",
    swatch: "bg-teal-500",
  },
  maintenance: {
    chip: "border-orange-400 bg-orange-50 text-orange-900 hover:bg-orange-100",
    badge: "bg-orange-50 text-orange-800 ring-orange-200",
    swatch: "bg-orange-400",
  },
  deadline: {
    chip: "border-violet-400 bg-violet-50 text-violet-900 hover:bg-violet-100",
    badge: "bg-violet-50 text-violet-800 ring-violet-200",
    swatch: "bg-violet-400",
  },
};

const FALLBACK_APPEARANCE: CalendarEventAppearance = {
  chip: "border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200",
  badge: "bg-slate-100 text-slate-700 ring-slate-200",
  swatch: "bg-slate-400",
};

export function calendarEventAppearance(
  eventType: string,
): CalendarEventAppearance {
  return isCalendarEventType(eventType)
    ? EVENT_APPEARANCE[eventType]
    : FALLBACK_APPEARANCE;
}

export function calendarEventTypeLabel(eventType: string): string {
  if (isCalendarEventType(eventType)) {
    return CALENDAR_EVENT_TYPE_LABELS[eventType];
  }
  if (!eventType) return "Event";
  return eventType.charAt(0).toUpperCase() + eventType.slice(1);
}

export function eventDayKey(startAt: string): string {
  return startAt.slice(0, 10);
}

export function eventsForDay(
  events: CalendarEventSummary[],
  dayKey: string,
): CalendarEventSummary[] {
  return events.filter((event) => eventDayKey(event.startAt) === dayKey);
}

export function groupEventsByDay(
  events: CalendarEventSummary[],
): Array<{ dayKey: string; events: CalendarEventSummary[] }> {
  const map = new Map<string, CalendarEventSummary[]>();

  for (const event of events) {
    const dayKey = eventDayKey(event.startAt);
    const dayEvents = map.get(dayKey) ?? [];
    dayEvents.push(event);
    map.set(dayKey, dayEvents);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, dayEvents]) => ({ dayKey, events: dayEvents }));
}
