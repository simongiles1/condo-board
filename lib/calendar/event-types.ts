export type CalendarEventSummary = {
  id: string;
  title: string;
  eventType: string;
  startAt: string;
  description: string | null;
};

export function eventsForDay(
  events: CalendarEventSummary[],
  dayKey: string,
): CalendarEventSummary[] {
  return events.filter((event) => event.startAt.startsWith(dayKey));
}
