/**
 * Google Calendar-style occurrence lifecycle for extracted events.
 *
 * - Cancellations hide the existing event (they are never calendar rows).
 * - Same-email reschedules MOVE the same row to the new date (stable id).
 * - Cancel in one email + new invite later = close old, insert new (new id).
 * - Proposed / unconfirmed dates do not belong in these arrays.
 */

import {
  calendarDeadlineDedupKey,
  calendarMeetingDedupKey,
} from "@/lib/email-analysis/calendar-dedup";
import { parseClockTime } from "@/lib/format/datetime";
import type {
  DeadlineExtraction,
  InspectionExtraction,
  MaintenanceEventExtraction,
  MeetingCancellationExtraction,
  MeetingExtraction,
  MeetingRescheduleExtraction,
} from "@/lib/email-analysis/schema";

export type CalendarEventStatus = "scheduled" | "cancelled";

export type ExistingCalendarEvent = {
  id: string;
  eventType: string;
  startAt: string;
  status: CalendarEventStatus;
  title: string;
  description: string | null;
  dedupKey: string | null;
  createdAt?: string | null;
};

export type PlannedCalendarWrite =
  | { op: "cancel"; eventId: string }
  | {
      op: "move";
      eventId: string;
      startAt: string;
      title: string;
      description: string | null;
      sourceQuote: string | null;
      dedupKey: string;
    }
  | {
      op: "insert";
      title: string;
      eventType: string;
      startAt: string;
      description: string | null;
      sourceQuote: string | null;
      dedupKey: string;
    };

type WorkingEvent = ExistingCalendarEvent & { consumed?: boolean };

export function meetingCalendarTitle(type?: string): string {
  const normalizedType = type?.replace(/\s*meeting\s*$/i, "").trim();
  return normalizedType ? `${normalizedType} meeting` : "Meeting";
}

export function inspectionCalendarTitle(type?: string): string {
  const normalized = type?.replace(/\s*inspection\s*$/i, "").trim();
  return normalized ? `${normalized} inspection` : "Inspection";
}

export function calendarStartAt(date: string, time?: string): string {
  const clock = parseClockTime(time);
  if (!clock) return date;
  const hour = String(clock.hour).padStart(2, "0");
  const minute = String(clock.minute).padStart(2, "0");
  return `${date}T${hour}:${minute}:00`;
}

export function eventDateKey(startAt: string): string {
  return startAt.slice(0, 10);
}

function eventTimeKey(startAt: string): string | undefined {
  if (!startAt.includes("T")) return undefined;
  return startAt.split("T")[1]?.slice(0, 5);
}

function scheduledMeetingsOn(
  events: WorkingEvent[],
  date: string,
  time?: string,
): WorkingEvent[] {
  const onDay = events.filter(
    (event) =>
      event.eventType === "meeting" &&
      event.status === "scheduled" &&
      !event.consumed &&
      eventDateKey(event.startAt) === date,
  );
  if (!time?.trim()) return onDay;
  const timed = onDay.filter((event) => eventTimeKey(event.startAt) === time.trim());
  return timed.length ? timed : onDay;
}

function pickMeeting(
  candidates: WorkingEvent[],
  type?: string,
): WorkingEvent | undefined {
  if (!candidates.length) return undefined;
  if (type?.trim()) {
    const want = meetingCalendarTitle(type).toLowerCase();
    const matched = candidates.find((event) => event.title.toLowerCase() === want);
    if (matched) return matched;
  }
  return candidates[0];
}

function hasScheduledOn(
  events: WorkingEvent[],
  eventType: string,
  startAt: string,
  dedupKey?: string | null,
): boolean {
  const date = eventDateKey(startAt);
  return events.some((event) => {
    if (event.status !== "scheduled" || event.consumed) return false;
    if (event.eventType !== eventType) return false;
    if (dedupKey && event.dedupKey === dedupKey) return true;
    return eventDateKey(event.startAt) === date;
  });
}

function inspectionDedupKey(inspection: InspectionExtraction): string | null {
  const date = inspection.date?.trim();
  if (!date) return null;
  const type = inspection.type?.trim().toLowerCase() || "inspection";
  return `inspection|${date}|${type}`;
}

function maintenanceCalendarDedupKey(
  event: MaintenanceEventExtraction,
): string | null {
  const date = event.date?.trim();
  if (!date) return null;
  const equipment = event.equipment?.trim().toLowerCase() || "";
  const time = event.time?.trim().toLowerCase() || "";
  return ["maintenance", equipment, date, time].filter(Boolean).join("|");
}

export function planCalendarLifecycle(input: {
  existing: ExistingCalendarEvent[];
  cancellations?: MeetingCancellationExtraction[];
  reschedules?: MeetingRescheduleExtraction[];
  meetings?: MeetingExtraction[];
  deadlines?: DeadlineExtraction[];
  inspections?: InspectionExtraction[];
  maintenanceEvents?: MaintenanceEventExtraction[];
}): PlannedCalendarWrite[] {
  const working: WorkingEvent[] = input.existing.map((event) => ({ ...event }));
  const writes: PlannedCalendarWrite[] = [];

  for (const reschedule of input.reschedules ?? []) {
    const originalDate = reschedule.original_date?.trim();
    const newDate = reschedule.new_date?.trim();
    if (!originalDate || !newDate) continue;

    const target = pickMeeting(
      scheduledMeetingsOn(working, originalDate, reschedule.original_time),
      reschedule.type,
    );
    const startAt = calendarStartAt(newDate, reschedule.new_time);
    const title = meetingCalendarTitle(reschedule.type);
    const description = reschedule.location ?? target?.description ?? null;
    const sourceQuote = reschedule.source_quote ?? null;
    const dedupKey =
      calendarMeetingDedupKey({
        type: reschedule.type,
        date: newDate,
        time: reschedule.new_time,
        location: reschedule.location,
        source_quote: reschedule.source_quote,
      }) ?? `meeting|${newDate}`;

    if (target) {
      writes.push({
        op: "move",
        eventId: target.id,
        startAt,
        title,
        description,
        sourceQuote,
        dedupKey,
      });
      target.startAt = startAt;
      target.title = title;
      target.description = description;
      target.dedupKey = dedupKey;
    } else if (!hasScheduledOn(working, "meeting", startAt, dedupKey)) {
      writes.push({
        op: "insert",
        title,
        eventType: "meeting",
        startAt,
        description,
        sourceQuote,
        dedupKey,
      });
      working.push({
        id: `planned:${writes.length}`,
        eventType: "meeting",
        startAt,
        status: "scheduled",
        title,
        description,
        dedupKey,
      });
    }
  }

  for (const cancel of input.cancellations ?? []) {
    const date = cancel.date?.trim();
    if (!date) continue;
    const matches = scheduledMeetingsOn(working, date, cancel.time);
    for (const match of matches) {
      writes.push({ op: "cancel", eventId: match.id });
      match.status = "cancelled";
      match.consumed = true;
    }
  }

  for (const meeting of input.meetings ?? []) {
    const date = meeting.date?.trim();
    if (!date) continue;
    const startAt = calendarStartAt(date, meeting.time);
    const dedupKey = calendarMeetingDedupKey(meeting);
    if (!dedupKey) continue;
    if (hasScheduledOn(working, "meeting", startAt, dedupKey)) continue;

    const title = meetingCalendarTitle(meeting.type);
    const description = meeting.location ?? null;
    writes.push({
      op: "insert",
      title,
      eventType: "meeting",
      startAt,
      description,
      sourceQuote: meeting.source_quote ?? null,
      dedupKey,
    });
    working.push({
      id: `planned:${writes.length}`,
      eventType: "meeting",
      startAt,
      status: "scheduled",
      title,
      description,
      dedupKey,
    });
  }

  for (const deadline of input.deadlines ?? []) {
    if (!deadline.date) continue;
    const dedupKey = calendarDeadlineDedupKey(deadline);
    if (!dedupKey) continue;
    const startAt = deadline.date;
    if (hasScheduledOn(working, "deadline", startAt, dedupKey)) continue;
    writes.push({
      op: "insert",
      title: deadline.description,
      eventType: "deadline",
      startAt,
      description: deadline.assignee ?? null,
      sourceQuote: deadline.source_quote ?? null,
      dedupKey,
    });
    working.push({
      id: `planned:${writes.length}`,
      eventType: "deadline",
      startAt,
      status: "scheduled",
      title: deadline.description,
      description: deadline.assignee ?? null,
      dedupKey,
    });
  }

  for (const inspection of input.inspections ?? []) {
    const date = inspection.date?.trim();
    if (!date) continue;
    const dedupKey = inspectionDedupKey(inspection);
    if (!dedupKey) continue;
    const startAt = date;
    if (hasScheduledOn(working, "inspection", startAt, dedupKey)) continue;
    const title = inspectionCalendarTitle(inspection.type);
    writes.push({
      op: "insert",
      title,
      eventType: "inspection",
      startAt,
      description: inspection.result ?? null,
      sourceQuote: inspection.source_quote ?? null,
      dedupKey,
    });
    working.push({
      id: `planned:${writes.length}`,
      eventType: "inspection",
      startAt,
      status: "scheduled",
      title,
      description: inspection.result ?? null,
      dedupKey,
    });
  }

  for (const event of input.maintenanceEvents ?? []) {
    const date = event.date?.trim();
    if (!date) continue;
    const dedupKey = maintenanceCalendarDedupKey(event);
    if (!dedupKey) continue;
    const startAt = calendarStartAt(date, event.time);
    if (hasScheduledOn(working, "maintenance", startAt, dedupKey)) continue;
    const title = `${event.action}: ${event.equipment}`;
    writes.push({
      op: "insert",
      title,
      eventType: "maintenance",
      startAt,
      description: event.description ?? null,
      sourceQuote: event.source_quote ?? null,
      dedupKey,
    });
    working.push({
      id: `planned:${writes.length}`,
      eventType: "maintenance",
      startAt,
      status: "scheduled",
      title,
      description: event.description ?? null,
      dedupKey,
    });
  }

  return writes;
}

export type CalendarHarvestSlice = {
  receivedAt?: string;
  meetings?: MeetingExtraction[];
  cancellations?: MeetingCancellationExtraction[];
  reschedules?: MeetingRescheduleExtraction[];
  deadlines?: DeadlineExtraction[];
  inspections?: InspectionExtraction[];
  maintenanceEvents?: MaintenanceEventExtraction[];
};

/** Apply planned writes to an in-memory calendar (tests + replay helpers). */
export function applyCalendarWritesToState(
  existing: ExistingCalendarEvent[],
  writes: PlannedCalendarWrite[],
): ExistingCalendarEvent[] {
  const next = existing.map((event) => ({ ...event }));
  let insertSeq = 0;
  for (const write of writes) {
    if (write.op === "cancel") {
      const row = next.find((event) => event.id === write.eventId);
      if (row) row.status = "cancelled";
      continue;
    }
    if (write.op === "move") {
      const row = next.find((event) => event.id === write.eventId);
      if (row) {
        row.startAt = write.startAt;
        row.title = write.title;
        row.description = write.description;
        row.dedupKey = write.dedupKey;
      }
      continue;
    }
    insertSeq += 1;
    next.push({
      id: `inserted:${insertSeq}:${write.startAt}`,
      eventType: write.eventType,
      startAt: write.startAt,
      status: "scheduled",
      title: write.title,
      description: write.description,
      dedupKey: write.dedupKey,
    });
  }
  return next;
}

/** Apply harvest slices in the given order (caller sorts by receivedAt). */
export function foldCalendarHarvests(
  existing: ExistingCalendarEvent[],
  harvests: CalendarHarvestSlice[],
): ExistingCalendarEvent[] {
  let events = existing.map((event) => ({ ...event }));
  for (const harvest of harvests) {
    const writes = planCalendarLifecycle({
      existing: events,
      meetings: harvest.meetings,
      cancellations: harvest.cancellations,
      reschedules: harvest.reschedules,
      deadlines: harvest.deadlines,
      inspections: harvest.inspections,
      maintenanceEvents: harvest.maintenanceEvents,
    });
    events = applyCalendarWritesToState(events, writes);
  }
  return events;
}

/**
 * Re-apply only cancel/reschedule mutations. Use after harvests were persisted
 * out of email order so a late invite can still be closed or moved.
 */
export function replayCalendarLifecycleMutations(
  existing: ExistingCalendarEvent[],
  harvests: CalendarHarvestSlice[],
): ExistingCalendarEvent[] {
  return foldCalendarHarvests(
    existing,
    harvests.map((harvest) => ({
      cancellations: harvest.cancellations,
      reschedules: harvest.reschedules,
    })),
  );
}

function meetingCollapseKey(event: ExistingCalendarEvent): string {
  return `${eventDateKey(event.startAt)}|${event.title.trim().toLowerCase()}`;
}

/**
 * Extra scheduled meetings that share date + title after a reschedule-first
 * persist (original invite inserted later, then the move duplicated the new date).
 */
export function collapseDuplicateScheduledMeetings(
  events: ExistingCalendarEvent[],
): PlannedCalendarWrite[] {
  const groups = new Map<string, ExistingCalendarEvent[]>();
  for (const event of events) {
    if (event.status !== "scheduled" || event.eventType !== "meeting") continue;
    const key = meetingCollapseKey(event);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  const writes: PlannedCalendarWrite[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [, ...extras] = [...group].sort((a, b) => {
      const created = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return created !== 0 ? created : a.id.localeCompare(b.id);
    });
    for (const extra of extras) {
      writes.push({ op: "cancel", eventId: extra.id });
    }
  }
  return writes;
}
