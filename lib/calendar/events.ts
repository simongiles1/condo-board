import { asc } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";

import type { CalendarEventSummary } from "./event-types";

export type { CalendarEventSummary } from "./event-types";
export { eventsForDay } from "./event-types";

export async function loadCalendarEvents(): Promise<CalendarEventSummary[]> {
  const db = getDb();
  return db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      eventType: calendarEvents.eventType,
      startAt: calendarEvents.startAt,
      description: calendarEvents.description,
    })
    .from(calendarEvents)
    .orderBy(asc(calendarEvents.startAt));
}
