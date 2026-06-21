/**
 * Tier-1 calendar deduplication using exact anchors only (no fuzzy text matching).
 * Same normalized date + same normalized source_quote → one item.
 * Fallback when no quote: exact normalized date + description (deadlines) or date-only (meetings).
 */

import type {
  DeadlineExtraction,
  EmailExtractionDocument,
  MeetingCancellationExtraction,
  MeetingExtraction,
} from "@/lib/email-analysis/schema";

export function normalizeExactAnchor(value: string | undefined | null): string | undefined {
  if (!value?.trim()) return undefined;
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function deadlineExactAnchorKey(deadline: DeadlineExtraction): string | null {
  const date = deadline.date?.trim();
  if (!date) return null;

  const quote = normalizeExactAnchor(deadline.source_quote);
  if (quote) return `deadline|${date}|quote:${quote}`;

  const description = normalizeExactAnchor(deadline.description);
  if (description) return `deadline|${date}|desc:${description}`;

  return `deadline|${date}`;
}

export function meetingExactAnchorKey(meeting: MeetingExtraction): string | null {
  const date = meeting.date?.trim();
  if (!date) return null;

  const quote = normalizeExactAnchor(meeting.source_quote);
  if (quote) return `meeting|${date}|quote:${quote}`;

  return `meeting|${date}`;
}

export function meetingCancellationExactAnchorKey(
  cancel: MeetingCancellationExtraction,
): string | null {
  const date = cancel.date?.trim();
  if (!date) return null;

  const time = cancel.time?.trim();
  if (time) return `meeting_cancel|${date}|${time}`;

  return `meeting_cancel|${date}`;
}

/** Persist-layer dedup key for deadline calendar rows — aligned with exact anchors. */
export function calendarDeadlineDedupKey(deadline: DeadlineExtraction): string | null {
  return deadlineExactAnchorKey(deadline);
}

/** Persist-layer dedup key for meeting calendar rows. */
export function calendarMeetingDedupKey(meeting: MeetingExtraction): string | null {
  return meetingExactAnchorKey(meeting);
}

function pickPreferredDeadline(
  existing: DeadlineExtraction,
  incoming: DeadlineExtraction,
): DeadlineExtraction {
  const existingDesc = existing.description?.trim() ?? "";
  const incomingDesc = incoming.description?.trim() ?? "";

  return {
    ...existing,
    description:
      incomingDesc.length > existingDesc.length ? incomingDesc : existingDesc,
    date: existing.date ?? incoming.date,
    assignee: existing.assignee ?? incoming.assignee,
    regulatory: existing.regulatory ?? incoming.regulatory,
    source_quote: existing.source_quote ?? incoming.source_quote,
  };
}

function pickPreferredMeeting(
  existing: MeetingExtraction,
  incoming: MeetingExtraction,
): MeetingExtraction {
  const existingType = existing.type?.trim() ?? "";
  const incomingType = incoming.type?.trim() ?? "";

  return {
    ...existing,
    type: incomingType.length > existingType.length ? incomingType : existingType,
    date: existing.date ?? incoming.date,
    time: existing.time ?? incoming.time,
    location: existing.location ?? incoming.location,
    agenda_items:
      (existing.agenda_items?.length ?? 0) >= (incoming.agenda_items?.length ?? 0)
        ? existing.agenda_items
        : incoming.agenda_items,
    source_quote: existing.source_quote ?? incoming.source_quote,
  };
}

function pickPreferredCancellation(
  existing: MeetingCancellationExtraction,
  incoming: MeetingCancellationExtraction,
): MeetingCancellationExtraction {
  return {
    ...existing,
    date: existing.date ?? incoming.date,
    time: existing.time ?? incoming.time,
    type: existing.type ?? incoming.type,
    reason: existing.reason ?? incoming.reason,
    source_quote: existing.source_quote ?? incoming.source_quote,
  };
}

function dedupeByExactAnchor<T>(
  items: T[],
  anchorKey: (item: T) => string | null,
  merge: (existing: T, incoming: T) => T,
): T[] {
  const result: T[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const key = anchorKey(item);
    if (!key) {
      result.push(item);
      continue;
    }

    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(item);
      continue;
    }

    result[existingIndex] = merge(result[existingIndex], item);
  }

  return result;
}

/** Collapse calendar-facing extraction arrays using exact anchors (tier 1). */
export function dedupeCalendarExtractions(
  document: EmailExtractionDocument,
): EmailExtractionDocument {
  return {
    ...document,
    deadlines: dedupeByExactAnchor(
      document.deadlines ?? [],
      deadlineExactAnchorKey,
      pickPreferredDeadline,
    ),
    meetings: dedupeByExactAnchor(
      document.meetings ?? [],
      meetingExactAnchorKey,
      pickPreferredMeeting,
    ),
    meeting_cancellations: dedupeByExactAnchor(
      document.meeting_cancellations ?? [],
      meetingCancellationExactAnchorKey,
      pickPreferredCancellation,
    ),
  };
}
