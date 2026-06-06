import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  calendarEvents,
  emailAttachments,
  emails,
  extractionSources,
  meetings,
} from "@/lib/db/schema";
import type { EmailExtractionDocument } from "@/lib/email-analysis/schema";

export type CalendarEventAttachmentSummary = {
  id: string;
  filename: string;
  mimeType: string;
  processedAt: string | null;
  hasValue?: boolean | null;
};

export type CalendarEventEmailSource = {
  kind: "email";
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  threadId: string | null;
  attachments: CalendarEventAttachmentSummary[];
  sourceQuote: string | null;
};

export type CalendarEventMeetingSource = {
  kind: "meeting";
  meetingId: string;
  title: string;
  meetingDate: string;
  sourceQuote: string | null;
};

export type CalendarEventSourceDetail = {
  event: {
    id: string;
    title: string;
    eventType: string;
    startAt: string;
    description: string | null;
  };
  source: CalendarEventEmailSource | CalendarEventMeetingSource | null;
};

function findSourceQuote(
  document: EmailExtractionDocument,
  event: { eventType: string; title: string; startAt: string },
): string | null {
  const dateOnly = event.startAt.split("T")[0];
  const timePart = event.startAt.includes("T")
    ? event.startAt.split("T")[1]?.slice(0, 5)
    : null;

  if (event.eventType === "meeting") {
    for (const meeting of document.meetings ?? []) {
      if (meeting.date !== dateOnly) continue;
      if (timePart && meeting.time && meeting.time !== timePart) continue;
      if (meeting.source_quote) return meeting.source_quote;
    }
  }

  if (event.eventType === "deadline") {
    for (const deadline of document.deadlines ?? []) {
      if (deadline.date === dateOnly && deadline.description === event.title) {
        return deadline.source_quote ?? null;
      }
    }
    for (const item of document.action_items ?? []) {
      if (item.deadline === dateOnly && item.task === event.title) {
        return item.source_quote ?? null;
      }
    }
  }

  if (event.eventType === "maintenance") {
    for (const maintenance of document.maintenance_events ?? []) {
      if (maintenance.date !== dateOnly) continue;
      if (maintenance.source_quote) return maintenance.source_quote;
    }
  }

  return null;
}

async function resolveEmailSource(input: {
  emailId: string;
  extractionJson: string;
  event: CalendarEventSourceDetail["event"];
}): Promise<CalendarEventEmailSource | null> {
  const db = getDb();
  const [email] = await db
    .select()
    .from(emails)
    .where(eq(emails.id, input.emailId));

  if (!email) return null;

  const attachments = await db
    .select({
      id: emailAttachments.id,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      processedAt: emailAttachments.processedAt,
      hasValue: emailAttachments.hasValue,
    })
    .from(emailAttachments)
    .where(eq(emailAttachments.emailId, email.id));

  let sourceQuote: string | null = null;
  try {
    const document = JSON.parse(input.extractionJson) as EmailExtractionDocument;
    sourceQuote = findSourceQuote(document, input.event);
  } catch {
    sourceQuote = null;
  }

  return {
    kind: "email",
    emailId: email.id,
    subject: email.subject,
    fromAddress: email.fromAddress,
    receivedAt: email.receivedAt,
    threadId: email.threadId,
    attachments,
    sourceQuote,
  };
}

export async function loadCalendarEventSource(
  eventId: string,
): Promise<CalendarEventSourceDetail | null> {
  const db = getDb();
  const [event] = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, eventId));

  if (!event) return null;

  const eventSummary = {
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    startAt: event.startAt,
    description: event.description,
  };

  const [source] = await db
    .select()
    .from(extractionSources)
    .where(eq(extractionSources.id, event.sourceId));

  if (!source) {
    return { event: eventSummary, source: null };
  }

  if (source.sourceType === "email_message") {
    const emailSource = await resolveEmailSource({
      emailId: source.sourceId,
      extractionJson: source.rawExtractionJson,
      event: eventSummary,
    });
    return { event: eventSummary, source: emailSource };
  }

  if (source.sourceType === "email_attachment") {
    const [attachment] = await db
      .select()
      .from(emailAttachments)
      .where(eq(emailAttachments.id, source.sourceId));

    if (!attachment) {
      return { event: eventSummary, source: null };
    }

    const emailSource = await resolveEmailSource({
      emailId: attachment.emailId,
      extractionJson: source.rawExtractionJson,
      event: eventSummary,
    });
    return { event: eventSummary, source: emailSource };
  }

  if (source.sourceType === "meeting") {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, source.sourceId));

    if (!meeting) {
      return { event: eventSummary, source: null };
    }

    return {
      event: eventSummary,
      source: {
        kind: "meeting",
        meetingId: meeting.id,
        title: meeting.title,
        meetingDate: meeting.meetingDate,
        sourceQuote: null,
      },
    };
  }

  return { event: eventSummary, source: null };
}
