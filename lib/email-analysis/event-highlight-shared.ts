/** Client-safe event-harvest types and helpers (no DB / Gemini imports). */

import { chunkContactHighlightText } from "@/lib/email-analysis/contact-highlight-shared";
import { dedupeCalendarExtractions } from "@/lib/email-analysis/calendar-dedup";
import {
  validateEmailExtraction,
  type DeadlineExtraction,
  type EmailExtractionDocument,
  type InspectionExtraction,
  type MaintenanceEventExtraction,
  type MeetingCancellationExtraction,
  type MeetingExtraction,
  type MeetingRescheduleExtraction,
} from "@/lib/email-analysis/schema";

export { chunkContactHighlightText as chunkEventHighlightText };

export const EVENT_HIGHLIGHT_TYPES = [
  "meeting",
  "cancellation",
  "reschedule",
  "deadline",
  "inspection",
  "maintenance",
] as const;

export type EventHighlightType = (typeof EVENT_HIGHLIGHT_TYPES)[number];

export const EVENT_HIGHLIGHT_LABELS: Record<EventHighlightType, string> = {
  meeting: "Meeting",
  cancellation: "Cancel",
  reschedule: "Moved",
  deadline: "Deadline",
  inspection: "Inspection",
  maintenance: "Maintenance",
};

export const EVENT_HIGHLIGHT_BADGE_CLASS: Record<EventHighlightType, string> = {
  meeting: "bg-sky-50 text-sky-900 ring-sky-200",
  cancellation: "bg-rose-50 text-rose-900 ring-rose-200",
  reschedule: "bg-amber-50 text-amber-900 ring-amber-200",
  deadline: "bg-violet-50 text-violet-900 ring-violet-200",
  inspection: "bg-teal-50 text-teal-900 ring-teal-200",
  maintenance: "bg-orange-50 text-orange-900 ring-orange-200",
};

export type EventHighlightExtraction = {
  meetings: MeetingExtraction[];
  meeting_cancellations: MeetingCancellationExtraction[];
  meeting_reschedules: MeetingRescheduleExtraction[];
  deadlines: DeadlineExtraction[];
  inspections: InspectionExtraction[];
  maintenance_events: MaintenanceEventExtraction[];
};

export type EventHighlightTypeCounts = Record<EventHighlightType, number>;

export function emptyEventHighlightExtraction(): EventHighlightExtraction {
  return {
    meetings: [],
    meeting_cancellations: [],
    meeting_reschedules: [],
    deadlines: [],
    inspections: [],
    maintenance_events: [],
  };
}

export function eventHighlightHasAny(
  extraction: EventHighlightExtraction,
): boolean {
  return (
    extraction.meetings.length > 0 ||
    extraction.meeting_cancellations.length > 0 ||
    extraction.meeting_reschedules.length > 0 ||
    extraction.deadlines.length > 0 ||
    extraction.inspections.length > 0 ||
    extraction.maintenance_events.length > 0
  );
}

export function eventHighlightHasLifecycleMutations(
  extraction: EventHighlightExtraction,
): boolean {
  return (
    extraction.meeting_cancellations.length > 0 ||
    extraction.meeting_reschedules.length > 0
  );
}

export function countEventHighlightTypes(
  extraction: EventHighlightExtraction,
): EventHighlightTypeCounts {
  return {
    meeting: extraction.meetings.length,
    cancellation: extraction.meeting_cancellations.length,
    reschedule: extraction.meeting_reschedules.length,
    deadline: extraction.deadlines.length,
    inspection: extraction.inspections.length,
    maintenance: extraction.maintenance_events.length,
  };
}

export function eventHighlightToDocument(
  extraction: EventHighlightExtraction,
): EmailExtractionDocument {
  return {
    meetings: extraction.meetings,
    meeting_cancellations: extraction.meeting_cancellations,
    meeting_reschedules: extraction.meeting_reschedules,
    deadlines: extraction.deadlines,
    inspections: extraction.inspections,
    maintenance_events: extraction.maintenance_events,
  };
}

export function eventHighlightFromDocument(
  document: EmailExtractionDocument,
): EventHighlightExtraction {
  return sanitizeEventHighlightExtraction({
    meetings: document.meetings ?? [],
    meeting_cancellations: document.meeting_cancellations ?? [],
    meeting_reschedules: document.meeting_reschedules ?? [],
    deadlines: document.deadlines ?? [],
    inspections: document.inspections ?? [],
    maintenance_events: document.maintenance_events ?? [],
  });
}

/**
 * Keep harvest arrays aligned with Google Calendar persist order:
 * reschedule (move) wins over cancel-of-original; cancel drops meetings on
 * that date so a leaked meetings[] row cannot resurrect the cancelled slot;
 * a same-email move does not also insert the new date.
 */
export function sanitizeEventHighlightExtraction(
  extraction: EventHighlightExtraction,
): EventHighlightExtraction {
  const rescheduleOriginalDates = new Set(
    extraction.meeting_reschedules
      .map((item) => item.original_date?.trim())
      .filter((date): date is string => Boolean(date)),
  );
  const rescheduleNewDates = new Set(
    extraction.meeting_reschedules
      .map((item) => item.new_date?.trim())
      .filter((date): date is string => Boolean(date)),
  );

  const meeting_cancellations = extraction.meeting_cancellations.filter(
    (item) => {
      const date = item.date?.trim();
      return Boolean(date) && !rescheduleOriginalDates.has(date);
    },
  );
  const cancelledDates = new Set(
    meeting_cancellations
      .map((item) => item.date?.trim())
      .filter((date): date is string => Boolean(date)),
  );

  const meetings = extraction.meetings.filter((item) => {
    const date = item.date?.trim();
    if (!date) return false;
    if (cancelledDates.has(date)) return false;
    if (rescheduleOriginalDates.has(date)) return false;
    if (rescheduleNewDates.has(date)) return false;
    return true;
  });

  const deadlines = extraction.deadlines.filter((item) =>
    Boolean(item.description?.trim() && item.date?.trim()),
  );
  const inspections = extraction.inspections.filter((item) =>
    Boolean(item.date?.trim()),
  );
  const maintenance_events = extraction.maintenance_events.filter((item) =>
    Boolean(item.date?.trim() && item.equipment?.trim() && item.action?.trim()),
  );

  return {
    meetings,
    meeting_cancellations,
    meeting_reschedules: extraction.meeting_reschedules.filter(
      (item) =>
        Boolean(item.original_date?.trim()) && Boolean(item.new_date?.trim()),
    ),
    deadlines,
    inspections,
    maintenance_events,
  };
}

export function mergeEventHighlightExtractions(
  extractions: EventHighlightExtraction[],
): EventHighlightExtraction {
  const merged = emptyEventHighlightExtraction();
  for (const extraction of extractions) {
    merged.meetings.push(...extraction.meetings);
    merged.meeting_cancellations.push(...extraction.meeting_cancellations);
    merged.meeting_reschedules.push(...extraction.meeting_reschedules);
    merged.deadlines.push(...extraction.deadlines);
    merged.inspections.push(...extraction.inspections);
    merged.maintenance_events.push(...extraction.maintenance_events);
  }
  return eventHighlightFromDocument(dedupeCalendarExtractions(merged));
}

export function parseEventHighlightExtraction(
  raw: unknown,
): EventHighlightExtraction {
  const { document } = validateEmailExtraction(raw);
  return eventHighlightFromDocument(document);
}

export function parseEventHighlightJson(text: string): EventHighlightExtraction {
  const trimmed = text.trim();
  if (!trimmed) return emptyEventHighlightExtraction();
  try {
    return parseEventHighlightExtraction(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseEventHighlightExtraction(
          JSON.parse(trimmed.slice(start, end + 1)),
        );
      } catch {
        return emptyEventHighlightExtraction();
      }
    }
    return emptyEventHighlightExtraction();
  }
}

export function buildEventHighlightSystemPrompt(): string {
  return `You extract calendar occurrences from a single condo-board email.

Domain context: These emails concern Studio 1 / TSCC 2517, a Toronto condominium corporation. Extract ONLY information explicitly stated — do not infer, guess, or extrapolate.

Return ONLY valid JSON with this exact shape:
{
  "meetings": [{ "type", "date", "time", "location", "agenda_items", "source_quote" }],
  "meeting_cancellations": [{ "date", "time", "type", "reason", "source_quote" }],
  "meeting_reschedules": [{ "original_date", "original_time", "new_date", "new_time", "type", "location", "source_quote" }],
  "deadlines": [{ "description", "date", "assignee", "regulatory", "source_quote" }],
  "inspections": [{ "type", "date", "result", "next_due", "source_quote" }],
  "maintenance_events": [{ "equipment", "action", "date", "time", "vendor", "cost", "work_order", "status", "description", "source_quote" }]
}

Rules:
- Include source_quote with a brief verbatim excerpt for each fact when possible.
- Use ISO dates (YYYY-MM-DD) and 24h times (HH:MM) when stated.
- Empty arrays are required when a domain has no relevant content.
- Do NOT emit contacts, people, organizations, vendors-as-registry, equipment_mentions, action_items, to-dos, or any other domain. This pass is calendar-only.

CRITICAL — what belongs on the calendar:
The downstream system promotes these arrays into a board calendar, Google Calendar style. Be strict.

CRITICAL — calendar label capitalization (shown verbatim on the board calendar):
Use sentence case — capitalize the first word and proper nouns/acronyms only; do NOT emit all-lowercase strings and do NOT use Title Case on every word.
- maintenance_events: the action and equipment fields become one title, "action: equipment", with a space after the colon. Write both fields in sentence case.
  Good: action "Site review visit", equipment "heat pump system" → "Site review visit: heat pump system"
  Bad: "site review visit: heat pump system" (all lowercase)
  Bad: "Site Review Visit: Heat Pump System" (title case every word)
- meetings: type is a short label (e.g. "Board", "AGM"); the calendar shows "Board meeting" — not "board meeting" or "Board Meeting".
- deadlines: description in sentence case (e.g. "Insurance renewal filing due").
Keep common words (of, the, for, and, to, in, on) lowercase unless they start the phrase. Preserve acronyms and proper nouns from the source (TSCC, AGM, HVAC, vendor names).

- meetings[]: ONLY a newly confirmed scheduled gathering with a firm date (e.g. a Microsoft Teams "meeting has been added to your calendar" invite). Do NOT include cancellations, postponements, reschedule proposals, or floated candidate dates. If multiple dates are discussed and none is confirmed, omit the meeting.
- meeting_cancellations[]: the meeting is cancelled with NO replacement date in THIS email (subject "Canceled:"/"Cancelled:"/"Postponed:", body "the board meeting on X has been cancelled", or .ics METHOD:CANCEL / STATUS:CANCELLED). date and time MUST be the original meeting's date/time so the system can pull that event OFF the calendar. Do NOT emit a calendar row for the cancellation itself. Include type when known (e.g. "Board", "AGM"). If a later email sends a new invite, that later email uses meetings[] — it is a new event, not this cancellation.
- meeting_reschedules[]: ONE email that moves an already-confirmed meeting from an old date/time to a new confirmed date/time (e.g. "the board meeting is moved from July 30 to August 2"). original_date is the slot currently on the calendar; new_date is where it should appear. The system MOVES the same calendar event. Do NOT also emit meeting_cancellations or meetings for the same move.
- deadlines[]: only HARD external deadlines tied to a specific calendar date — regulatory filings, insurance renewal, tax/audit due dates, permit expiry, statutory notice periods, contractually fixed dates. Mark regulatory: true when applicable. Do NOT use deadlines[] for internal asks like "please respond by X" or "share thoughts by X" — those are to-dos (out of scope for this pass). Omit them.
- maintenance_events[]: only when a specific date is stated for the work (scheduled, completed, or planned). Skip if no date. Use the equipment name as free text — do not invent make/model/assets and do not emit equipment registry rows.
- inspections[]: only when a specific date is stated.

When in doubt, prefer omitting a fact over fabricating a date or status.`;
}

export type EventHighlightEmailContext = {
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  highlightedText: string;
};

export function buildEventHighlightUserPrompt(
  input: EventHighlightEmailContext,
): string {
  const toLine =
    input.toAddresses.length > 0 ? input.toAddresses.join(", ") : "(none)";
  const ccLine =
    input.ccAddresses.length > 0 ? input.ccAddresses.join(", ") : "(none)";
  return `EMAIL
From: ${input.fromAddress || "(unknown)"}
To: ${toLine}
Cc: ${ccLine}
Subject: ${input.subject || "(no subject)"}

--- BODY (unique / authored highlight for this message) ---
${input.highlightedText}
---

Extract meetings, meeting_cancellations, meeting_reschedules, deadlines, inspections, and dated maintenance_events as JSON. Omit contacts, orgs, equipment registry, and to-dos.`;
}
