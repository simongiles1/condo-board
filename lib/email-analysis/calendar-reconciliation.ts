import { and, asc, eq, inArray } from "drizzle-orm";

import {
  CALENDAR_RECONCILIATION_SYSTEM_PROMPT,
  buildCalendarReconciliationUserPrompt,
} from "@/lib/email-analysis/prompts";
import {
  calendarDeadlineDedupKey,
  calendarMeetingDedupKey,
  normalizeExactAnchor,
} from "@/lib/email-analysis/calendar-dedup";
import { validateEmailExtraction } from "@/lib/email-analysis/schema";
import { getDb } from "@/lib/db";
import { calendarEvents, emails, extractionSources } from "@/lib/db/schema";
import { formatExtractionFieldKeyLabel } from "@/lib/email/extraction-routing";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { unwrapJsonCodeBlock } from "@/lib/gemini/parse-output";
import {
  estimateCostUsdForCalls,
  type GeminiUsageCall,
} from "@/lib/gemini/usage";

const MAX_THREAD_CHARS = 120_000;
const RECONCILIATION_MAX_OUTPUT_TOKENS = 8192;

export type ReconciledCalendarEvent = {
  canonical_title: string;
  event_type: "deadline" | "meeting" | "maintenance";
  start_at: string;
  end_at?: string;
  description?: string;
  source_quote?: string;
  merged_event_ids: string[];
};

export type CalendarReconciliationResult = {
  events: ReconciledCalendarEvent[];
};

export type ReconcileThreadCalendarResult = {
  beforeCount: number;
  afterCount: number;
  calls: GeminiUsageCall[];
  costUsd: number;
};

type ThreadCalendarRow = {
  id: string;
  title: string;
  eventType: string;
  startAt: string;
  endAt: string | null;
  description: string | null;
  dedupKey: string | null;
  sourceQuote?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

function parseEventType(value: unknown): ReconciledCalendarEvent["event_type"] {
  const type = asString(value);
  if (type === "meeting" || type === "maintenance") return type;
  return "deadline";
}

export function parseCalendarReconciliationResult(
  raw: unknown,
): CalendarReconciliationResult {
  if (!isObject(raw)) return { events: [] };

  const eventsRaw = raw.events;
  if (!Array.isArray(eventsRaw)) return { events: [] };

  const events: ReconciledCalendarEvent[] = [];
  for (const entry of eventsRaw) {
    if (!isObject(entry)) continue;

    const canonicalTitle = asString(entry.canonical_title);
    const startAt = asString(entry.start_at);
    const mergedIds = asStringArray(entry.merged_event_ids);
    if (!canonicalTitle || !startAt || mergedIds.length === 0) continue;

    events.push({
      canonical_title: canonicalTitle,
      event_type: parseEventType(entry.event_type),
      start_at: startAt,
      end_at: asString(entry.end_at),
      description: asString(entry.description),
      source_quote: asString(entry.source_quote),
      merged_event_ids: mergedIds,
    });
  }

  return { events };
}

function buildThreadTranscript(
  messages: Array<{
    fromAddress: string;
    subject: string;
    receivedAt: string;
    bodyTextUnique: string | null;
    bodyText: string;
  }>,
): string {
  const blocks = messages.map((message, index) => {
    const body = (message.bodyTextUnique ?? message.bodyText).trim();
    return [
      `--- Message ${index + 1} ---`,
      `From: ${message.fromAddress}`,
      `Date: ${message.receivedAt}`,
      `Subject: ${message.subject}`,
      "Body:",
      body,
    ].join("\n");
  });

  let transcript = blocks.join("\n\n");
  if (transcript.length > MAX_THREAD_CHARS) {
    transcript = `${transcript.slice(-MAX_THREAD_CHARS)}\n\n[Thread truncated to the most recent ${MAX_THREAD_CHARS} characters.]`;
  }

  return transcript;
}

function quoteLookupFromDocument(
  document: ReturnType<typeof validateEmailExtraction>["document"],
): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const deadline of document.deadlines ?? []) {
    const key = calendarDeadlineDedupKey(deadline);
    const quote = deadline.source_quote?.trim();
    if (key && quote) lookup.set(key, quote);
  }

  for (const meeting of document.meetings ?? []) {
    const key = calendarMeetingDedupKey(meeting);
    const quote = meeting.source_quote?.trim();
    if (key && quote) lookup.set(key, quote);
  }

  return lookup;
}

async function loadThreadMessages(threadId: string) {
  const db = getDb();
  return db
    .select({
      fromAddress: emails.fromAddress,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
      bodyTextUnique: emails.bodyTextUnique,
      bodyText: emails.bodyText,
    })
    .from(emails)
    .where(eq(emails.threadId, threadId))
    .orderBy(asc(emails.receivedAt));
}

async function loadThreadCalendarRows(threadId: string): Promise<ThreadCalendarRow[]> {
  const db = getDb();

  const sourceRows = await db
    .select({
      id: extractionSources.id,
      rawExtractionJson: extractionSources.rawExtractionJson,
    })
    .from(extractionSources)
    .where(eq(extractionSources.emailThreadId, threadId));

  const sourceIds = sourceRows.map((row) => row.id);
  if (!sourceIds.length) return [];

  const quoteByDedupKey = new Map<string, string>();
  for (const source of sourceRows) {
    const { document } = validateEmailExtraction(JSON.parse(source.rawExtractionJson));
    for (const [key, quote] of quoteLookupFromDocument(document)) {
      if (!quoteByDedupKey.has(key)) quoteByDedupKey.set(key, quote);
    }
  }

  const rows = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      eventType: calendarEvents.eventType,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      description: calendarEvents.description,
      dedupKey: calendarEvents.dedupKey,
    })
    .from(calendarEvents)
    .where(inArray(calendarEvents.sourceId, sourceIds))
    .orderBy(asc(calendarEvents.startAt), asc(calendarEvents.title));

  return rows.map((row) => ({
    ...row,
    sourceQuote: row.dedupKey ? quoteByDedupKey.get(row.dedupKey) : undefined,
  }));
}

async function applyCalendarReconciliation(input: {
  reconciled: ReconciledCalendarEvent[];
  knownIds: Set<string>;
}): Promise<number> {
  const db = getDb();
  let canonicalCount = 0;

  for (const item of input.reconciled) {
    const mergedIds = item.merged_event_ids.filter((id) => input.knownIds.has(id));
    if (!mergedIds.length) continue;

    const keepId = mergedIds[0];
    const deleteIds = mergedIds.slice(1);
    const normalizedQuote = normalizeExactAnchor(item.source_quote);
    const date = item.start_at.slice(0, 10);

    let dedupKey: string | null = null;
    if (item.event_type === "deadline") {
      dedupKey = normalizedQuote
        ? `deadline|${date}|quote:${normalizedQuote}`
        : `deadline|${date}|desc:${normalizeExactAnchor(item.canonical_title)}`;
    } else if (item.event_type === "meeting") {
      dedupKey = normalizedQuote
        ? `meeting|${date}|quote:${normalizedQuote}`
        : `meeting|${date}`;
    }

    await db
      .update(calendarEvents)
      .set({
        title: item.canonical_title.trim(),
        eventType: item.event_type,
        startAt: item.start_at,
        endAt: item.end_at ?? null,
        description: item.description ?? null,
        dedupKey,
      })
      .where(eq(calendarEvents.id, keepId));

    if (deleteIds.length) {
      await db.delete(calendarEvents).where(inArray(calendarEvents.id, deleteIds));
    }

    canonicalCount += 1;
  }

  return canonicalCount;
}

export async function reconcileThreadCalendar(input: {
  threadId: string;
  modelName: string;
}): Promise<ReconcileThreadCalendarResult> {
  const threadCalendar = await loadThreadCalendarRows(input.threadId);
  if (threadCalendar.length < 2) {
    return {
      beforeCount: threadCalendar.length,
      afterCount: threadCalendar.length,
      calls: [],
      costUsd: 0,
    };
  }

  const threadMessages = await loadThreadMessages(input.threadId);
  if (!threadMessages.length) {
    return {
      beforeCount: threadCalendar.length,
      afterCount: threadCalendar.length,
      calls: [],
      costUsd: 0,
    };
  }

  const userPrompt = buildCalendarReconciliationUserPrompt({
    threadTranscript: buildThreadTranscript(threadMessages),
    calendarEvents: threadCalendar.map((row) => ({
      id: row.id,
      title: row.title,
      event_type: row.eventType,
      start_at: row.startAt,
      end_at: row.endAt,
      description: row.description,
      source_quote: row.sourceQuote ?? null,
      dedup_key: row.dedupKey,
    })),
  });

  const generation = await generateEmailExtraction({
    systemInstruction: CALENDAR_RECONCILIATION_SYSTEM_PROMPT,
    userText: userPrompt,
    modelName: input.modelName,
    maxOutputTokens: RECONCILIATION_MAX_OUTPUT_TOKENS,
    step: "calendar_reconciliation",
  });

  const { jsonText } = unwrapJsonCodeBlock(generation.text);
  const parsed = parseCalendarReconciliationResult(JSON.parse(jsonText) as unknown);

  if (!parsed.events.length) {
    console.warn("[email-analysis:calendar-reconcile]", {
      threadId: input.threadId,
      message: "AI returned no events; keeping original rows",
    });
    return {
      beforeCount: threadCalendar.length,
      afterCount: threadCalendar.length,
      calls: generation.usageCalls,
      costUsd: estimateCostUsdForCalls(generation.usageCalls),
    };
  }

  const knownIds = new Set(threadCalendar.map((row) => row.id));
  await applyCalendarReconciliation({
    reconciled: parsed.events,
    knownIds,
  });

  const afterCount = (await loadThreadCalendarRows(input.threadId)).length;
  const calls = generation.usageCalls;
  const costUsd = estimateCostUsdForCalls(calls);

  console.info("[email-analysis:calendar-reconcile]", {
    threadId: input.threadId,
    beforeCount: threadCalendar.length,
    afterCount,
    canonicalGroups: parsed.events.length,
    costUsd,
  });

  return {
    beforeCount: threadCalendar.length,
    afterCount,
    calls,
    costUsd,
  };
}

export function buildCalendarAuditSummary(input: {
  eventType: string;
  title: string;
  startAt: string;
}): string {
  const date = input.startAt.slice(0, 10);
  return `${input.title} (${date})`;
}

export async function buildThreadReconciledCalendarAuditItems(
  threadId: string,
): Promise<
  Array<{
    fieldKey: string;
    fieldLabel: string;
    summary: string;
    sourceQuote?: string;
    persisted: boolean;
  }>
> {
  const rows = await loadThreadCalendarRows(threadId);
  if (!rows.length) return [];

  return rows
    .filter((row) => row.eventType === "deadline" || row.eventType === "meeting")
    .map((row) => {
      const fieldKey = row.eventType === "meeting" ? "meetings" : "deadlines";
      return {
        fieldKey,
        fieldLabel: formatExtractionFieldKeyLabel(fieldKey),
        summary: buildCalendarAuditSummary({
          eventType: row.eventType,
          title: row.title,
          startAt: row.startAt,
        }),
        sourceQuote: row.sourceQuote,
        persisted: true,
      };
    });
}
