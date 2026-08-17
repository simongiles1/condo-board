/** Client-safe display shapes for event-harvest run summaries. */

import {
  inspectionCalendarTitle,
  meetingCalendarTitle,
} from "@/lib/email-analysis/calendar-lifecycle";
import {
  EVENT_HIGHLIGHT_MODELS,
  type EventHighlightModelId,
} from "@/lib/email-analysis/event-highlight-models";
import {
  EVENT_HIGHLIGHT_TYPES,
  type EventHighlightExtraction,
  type EventHighlightType,
  type EventHighlightTypeCounts,
} from "@/lib/email-analysis/event-highlight-shared";

export type EventHighlightUsageDisplay = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  modelName: string;
};

export type EventHighlightModelRunDisplay = {
  usage: EventHighlightUsageDisplay;
  stats: {
    extracted: number;
    skipped: number;
    failed: number;
    typeCounts: EventHighlightTypeCounts;
  };
};

export type EventExtractListItem = {
  type: EventHighlightType;
  title: string;
  when: string | null;
  detail: string | null;
  emailId: string;
  sourceQuote: string | null;
};

export type EventExtractSummary = {
  totalCostUsd: number;
  runs: Partial<Record<EventHighlightModelId, EventHighlightModelRunDisplay>>;
  events: EventExtractListItem[];
};

type EventExtractRunWithExtractions = EventHighlightModelRunDisplay & {
  extractions?: Record<string, EventHighlightExtraction>;
};

const TYPE_ORDER = new Map(
  EVENT_HIGHLIGHT_TYPES.map((type, index) => [type, index]),
);

function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatHmTime(hm: string): string {
  const [hour, minute] = hm.split(":").map(Number);
  if (Number.isNaN(hour)) return hm;
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute || 0));
}

function formatWhen(date?: string, time?: string): string | null {
  const iso = date?.trim();
  if (!iso) return null;
  const dateLabel = formatIsoDate(iso);
  const hm = time?.trim();
  return hm ? `${dateLabel} · ${formatHmTime(hm)}` : dateLabel;
}

function joinDetail(parts: Array<string | null | undefined>): string | null {
  const cleaned = parts.map((part) => part?.trim()).filter(Boolean) as string[];
  return cleaned.length > 0 ? cleaned.join(" · ") : null;
}

type FlattenedEvent = EventExtractListItem & { sortDate: string };

function quoteOrNull(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function flattenEventHighlightExtraction(
  emailId: string,
  extraction: EventHighlightExtraction,
): FlattenedEvent[] {
  const items: FlattenedEvent[] = [];

  for (const meeting of extraction.meetings) {
    const date = meeting.date?.trim() ?? "";
    items.push({
      type: "meeting",
      title: meetingCalendarTitle(meeting.type),
      when: formatWhen(meeting.date, meeting.time),
      detail: joinDetail([meeting.location]),
      emailId,
      sourceQuote: quoteOrNull(meeting.source_quote),
      sortDate: date,
    });
  }

  for (const cancel of extraction.meeting_cancellations) {
    const date = cancel.date?.trim() ?? "";
    items.push({
      type: "cancellation",
      title: meetingCalendarTitle(cancel.type),
      when: formatWhen(cancel.date, cancel.time),
      detail: joinDetail([cancel.reason]),
      emailId,
      sourceQuote: quoteOrNull(cancel.source_quote),
      sortDate: date,
    });
  }

  for (const move of extraction.meeting_reschedules) {
    const fromWhen = formatWhen(move.original_date, move.original_time);
    const toWhen = formatWhen(move.new_date, move.new_time);
    items.push({
      type: "reschedule",
      title: meetingCalendarTitle(move.type),
      when:
        fromWhen && toWhen
          ? `${fromWhen} → ${toWhen}`
          : toWhen ?? fromWhen,
      detail: joinDetail([move.location]),
      emailId,
      sourceQuote: quoteOrNull(move.source_quote),
      sortDate: move.new_date?.trim() || move.original_date?.trim() || "",
    });
  }

  for (const deadline of extraction.deadlines) {
    items.push({
      type: "deadline",
      title: deadline.description.trim(),
      when: formatWhen(deadline.date),
      detail: joinDetail([
        deadline.assignee,
        deadline.regulatory ? "Regulatory" : null,
      ]),
      emailId,
      sourceQuote: quoteOrNull(deadline.source_quote),
      sortDate: deadline.date?.trim() ?? "",
    });
  }

  for (const inspection of extraction.inspections) {
    items.push({
      type: "inspection",
      title: inspectionCalendarTitle(inspection.type),
      when: formatWhen(inspection.date),
      detail: joinDetail([
        inspection.result,
        inspection.next_due
          ? `Next ${formatWhen(inspection.next_due)}`
          : null,
      ]),
      emailId,
      sourceQuote: quoteOrNull(inspection.source_quote),
      sortDate: inspection.date?.trim() ?? "",
    });
  }

  for (const event of extraction.maintenance_events) {
    const action = event.action.trim();
    const equipment = event.equipment.trim();
    items.push({
      type: "maintenance",
      title: `${action}: ${equipment}`,
      when: formatWhen(event.date, event.time),
      detail: joinDetail([event.vendor, event.status, event.description]),
      emailId,
      sourceQuote: quoteOrNull(event.source_quote),
      sortDate: event.date?.trim() ?? "",
    });
  }

  return items;
}

function eventsFromExtractRuns(
  runs: Partial<
    Record<string, EventExtractRunWithExtractions | null | undefined>
  >,
): EventExtractListItem[] {
  const seen = new Set<string>();
  const items: FlattenedEvent[] = [];

  for (const run of Object.values(runs)) {
    if (!run?.extractions) continue;
    for (const [emailId, extraction] of Object.entries(run.extractions)) {
      for (const item of flattenEventHighlightExtraction(emailId, extraction)) {
        const key = `${item.emailId}|${item.type}|${item.title}|${item.when ?? ""}|${item.detail ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }
  }

  items.sort((a, b) => {
    const dateCmp = a.sortDate.localeCompare(b.sortDate);
    if (dateCmp !== 0) return dateCmp;
    const typeCmp =
      (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0);
    if (typeCmp !== 0) return typeCmp;
    return a.title.localeCompare(b.title);
  });

  return items.map((item) => ({
    type: item.type,
    title: item.title,
    when: item.when,
    detail: item.detail,
    emailId: item.emailId,
    sourceQuote: item.sourceQuote,
  }));
}

export function eventExtractItemKey(
  item: EventExtractListItem,
  index: number,
): string {
  return `${item.emailId}|${item.type}|${item.title}|${item.when ?? ""}|${index}`;
}

export function totalCostFromEventExtractRuns(
  runs: Partial<Record<EventHighlightModelId, EventHighlightModelRunDisplay>>,
): number {
  let total = 0;
  for (const run of Object.values(runs)) {
    if (!run) continue;
    total += run.usage.costUsd;
  }
  return total;
}

/** Map GET /api/analysis/extract-events `runs` payload into a list summary. */
export function eventExtractSummaryFromApiRuns(
  runs: Partial<
    Record<string, EventExtractRunWithExtractions | null | undefined>
  >,
): EventExtractSummary | null {
  const displayRuns: EventExtractSummary["runs"] = {};
  let hasAny = false;

  for (const [modelId, run] of Object.entries(runs)) {
    if (!run) continue;
    if (!(EVENT_HIGHLIGHT_MODELS as readonly string[]).includes(modelId)) {
      continue;
    }
    hasAny = true;
    displayRuns[modelId as EventHighlightModelId] = {
      usage: run.usage,
      stats: run.stats,
    };
  }

  if (!hasAny) return null;

  return {
    runs: displayRuns,
    totalCostUsd: totalCostFromEventExtractRuns(displayRuns),
    events: eventsFromExtractRuns(runs),
  };
}

export function eventExtractItemCount(summary: EventExtractSummary): number {
  if (summary.events.length > 0) return summary.events.length;
  let best = 0;
  for (const run of Object.values(summary.runs)) {
    if (!run) continue;
    const total =
      run.stats.typeCounts.meeting +
      run.stats.typeCounts.cancellation +
      run.stats.typeCounts.reschedule +
      run.stats.typeCounts.deadline +
      run.stats.typeCounts.inspection +
      run.stats.typeCounts.maintenance;
    if (total > best) best = total;
  }
  return best;
}
