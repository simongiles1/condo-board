export type CalendarEventSummary = {
  id: string;
  title: string;
  eventType: string;
  startAt: string;
  description: string | null;
};

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
