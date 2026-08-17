import { randomUUID } from "crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emails,
  eventHighlightExtractions,
  extractionSources,
} from "@/lib/db/schema";
import { reconcileThreadCalendar } from "@/lib/email-analysis/calendar-reconciliation";
import {
  countEventHighlightTypes,
  emptyEventHighlightExtraction,
  eventHighlightHasAny,
  eventHighlightHasLifecycleMutations,
  eventHighlightToDocument,
  parseEventHighlightExtraction,
  type EventHighlightExtraction,
  type EventHighlightTypeCounts,
} from "@/lib/email-analysis/event-highlight-shared";
import {
  EVENT_HIGHLIGHT_MODELS,
  type EventHighlightModelId,
} from "@/lib/email-analysis/event-highlight-models";
import {
  applyHarvestCalendarMutations,
  collapseDuplicateScheduledCalendarMeetings,
  deleteExtractionEntities,
  persistExtractionDocument,
} from "@/lib/email-analysis/persist";
import { getAnalysisSettings } from "@/lib/email-analysis/settings";

export type EventHighlightModelRun = {
  extractions: Record<string, EventHighlightExtraction>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    modelName: string;
  };
  stats: {
    extracted: number;
    skipped: number;
    failed: number;
    typeCounts: EventHighlightTypeCounts;
  };
};

type SaveItem = {
  emailId: string;
  extraction: EventHighlightExtraction;
  skipped?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
};

function emptyTypeCounts(): EventHighlightTypeCounts {
  return {
    meeting: 0,
    cancellation: 0,
    reschedule: 0,
    deadline: 0,
    inspection: 0,
    maintenance: 0,
  };
}

function addTypeCounts(
  target: EventHighlightTypeCounts,
  incoming: EventHighlightTypeCounts,
): void {
  target.meeting += incoming.meeting;
  target.cancellation += incoming.cancellation;
  target.reschedule += incoming.reschedule;
  target.deadline += incoming.deadline;
  target.inspection += incoming.inspection;
  target.maintenance += incoming.maintenance;
}

function buildPassRun(
  modelId: EventHighlightModelId,
  rows: Array<{
    emailId: string;
    extraction: EventHighlightExtraction;
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
  }>,
): EventHighlightModelRun {
  const extractions: Record<string, EventHighlightExtraction> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let apiModelName: string = modelId;
  let extracted = 0;
  let skipped = 0;
  let failed = 0;
  const typeCounts = emptyTypeCounts();

  for (const row of rows) {
    extractions[row.emailId] = row.extraction;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    totalTokens += row.totalTokens;
    costUsd += row.costUsd;
    if (row.apiModelName) apiModelName = row.apiModelName;
    if (row.error) failed += 1;
    else if (row.skipped) skipped += 1;
    else if (eventHighlightHasAny(row.extraction)) extracted += 1;
    else skipped += 1;
    addTypeCounts(typeCounts, countEventHighlightTypes(row.extraction));
  }

  return {
    extractions,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      modelName: apiModelName,
    },
    stats: {
      extracted,
      skipped,
      failed,
      typeCounts,
    },
  };
}

export async function saveEventHighlightExtractions(
  modelId: EventHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const extractionJson = JSON.stringify(
      item.extraction ?? emptyEventHighlightExtraction(),
    );
    const inputTokens = item.usage?.inputTokens ?? null;
    const outputTokens = item.usage?.outputTokens ?? null;
    const totalTokens = item.usage?.totalTokens ?? null;
    const costUsd = item.costUsd != null ? String(item.costUsd) : null;

    const existing = await db
      .select({
        id: eventHighlightExtractions.id,
        persistSourceId: eventHighlightExtractions.persistSourceId,
      })
      .from(eventHighlightExtractions)
      .where(
        and(
          eq(eventHighlightExtractions.emailId, emailId),
          eq(eventHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(eventHighlightExtractions)
        .set({
          extractionJson,
          skipped: Boolean(item.skipped),
          error: item.error ?? null,
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd,
          apiModelName: item.modelName ?? null,
          updatedAt: now,
        })
        .where(eq(eventHighlightExtractions.id, existing[0].id));
    } else {
      await db.insert(eventHighlightExtractions).values({
        id: randomUUID(),
        emailId,
        modelId,
        extractionJson,
        skipped: Boolean(item.skipped),
        error: item.error ?? null,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
        apiModelName: item.modelName ?? null,
        persistSourceId: null,
        updatedAt: now,
      });
    }
  }
}

function createAsyncMutex() {
  let tail: Promise<void> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

const withCalendarPersistLock = createAsyncMutex();

function parseHarvestExtraction(json: string): EventHighlightExtraction {
  try {
    return parseEventHighlightExtraction(JSON.parse(json));
  } catch {
    return emptyEventHighlightExtraction();
  }
}

/**
 * Persist harvested calendar arrays through planCalendarLifecycle (email
 * receivedAt order), replay all cancel/reschedule mutations for this model so
 * cross-thread Teams mail still closes/moves, collapse duplicate meetings,
 * then reconcile each affected thread.
 */
export async function persistEventHarvestCalendar(
  modelId: EventHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  return withCalendarPersistLock(() =>
    persistEventHarvestCalendarUnlocked(modelId, items),
  );
}

/**
 * After a bulk events run: persist this run's emails plus any harvests that
 * never got a calendar source (crash/cancel mid-run), in receivedAt order.
 */
export async function persistEventHarvestsAfterBulkRun(
  modelId: EventHighlightModelId,
  processedEmailIds: string[],
): Promise<void> {
  return withCalendarPersistLock(async () => {
    const items = await loadSaveItemsForBulkPersist(modelId, processedEmailIds);
    await persistEventHarvestCalendarUnlocked(modelId, items);
  });
}

async function loadSaveItemsForBulkPersist(
  modelId: EventHighlightModelId,
  processedEmailIds: string[],
): Promise<SaveItem[]> {
  const processed = new Set(
    processedEmailIds.map((id) => id.trim()).filter(Boolean),
  );
  const db = getDb();
  const rows = await db
    .select()
    .from(eventHighlightExtractions)
    .where(eq(eventHighlightExtractions.modelId, modelId));

  const items: SaveItem[] = [];
  for (const row of rows) {
    if (row.error) continue;
    if (row.skipped) continue;
    const unpersisted = !row.persistSourceId;
    if (!unpersisted && !processed.has(row.emailId)) continue;
    items.push({
      emailId: row.emailId,
      extraction: parseHarvestExtraction(row.extractionJson),
      skipped: row.skipped,
      error: row.error ?? undefined,
      usage: {
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        totalTokens: row.totalTokens ?? 0,
      },
      costUsd: row.costUsd ? Number(row.costUsd) : 0,
      modelName: row.apiModelName ?? undefined,
    });
  }
  return items;
}

async function replayEventHarvestMutationsUnlocked(
  modelId: EventHighlightModelId,
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      emailId: eventHighlightExtractions.emailId,
      extractionJson: eventHighlightExtractions.extractionJson,
      persistSourceId: eventHighlightExtractions.persistSourceId,
      skipped: eventHighlightExtractions.skipped,
      error: eventHighlightExtractions.error,
      receivedAt: emails.receivedAt,
    })
    .from(eventHighlightExtractions)
    .innerJoin(emails, eq(emails.id, eventHighlightExtractions.emailId))
    .where(eq(eventHighlightExtractions.modelId, modelId))
    .orderBy(asc(emails.receivedAt), asc(eventHighlightExtractions.emailId));

  for (const row of rows) {
    if (!row.persistSourceId || row.skipped || row.error) continue;
    const extraction = parseHarvestExtraction(row.extractionJson);
    if (!eventHighlightHasLifecycleMutations(extraction)) continue;
    await applyHarvestCalendarMutations({
      sourceId: row.persistSourceId,
      cancellations: extraction.meeting_cancellations,
      reschedules: extraction.meeting_reschedules,
    });
  }
}

async function persistEventHarvestCalendarUnlocked(
  modelId: EventHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  const persistable = items.filter(
    (item) => item.emailId.trim() && !item.skipped && !item.error,
  );
  if (persistable.length === 0) {
    await replayEventHarvestMutationsUnlocked(modelId);
    await collapseDuplicateScheduledCalendarMeetings();
    return;
  }

  const db = getDb();
  const emailIds = [
    ...new Set(persistable.map((item) => item.emailId.trim())),
  ];
  const emailRows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      receivedAt: emails.receivedAt,
    })
    .from(emails)
    .where(inArray(emails.id, emailIds))
    .orderBy(asc(emails.receivedAt));

  const emailById = new Map(emailRows.map((row) => [row.id, row]));
  const ordered = persistable
    .map((item) => ({
      item,
      email: emailById.get(item.emailId.trim()),
    }))
    .filter(
      (
        entry,
      ): entry is {
        item: SaveItem;
        email: { id: string; threadId: string | null; receivedAt: string };
      } => Boolean(entry.email),
    )
    .sort((a, b) => {
      const byDate = a.email.receivedAt.localeCompare(b.email.receivedAt);
      return byDate !== 0 ? byDate : a.email.id.localeCompare(b.email.id);
    });

  const settings = await getAnalysisSettings();
  const threadIds = new Set<string>();

  for (const { item, email } of ordered) {
    const harvestRow = await db
      .select({
        id: eventHighlightExtractions.id,
        persistSourceId: eventHighlightExtractions.persistSourceId,
      })
      .from(eventHighlightExtractions)
      .where(
        and(
          eq(eventHighlightExtractions.emailId, email.id),
          eq(eventHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (harvestRow[0]?.persistSourceId) {
      await deleteExtractionEntities(harvestRow[0].persistSourceId);
    }

    const document = eventHighlightToDocument(
      item.extraction ?? emptyEventHighlightExtraction(),
    );
    const sourceId = randomUUID();
    const now = new Date().toISOString();
    await db.insert(extractionSources).values({
      id: sourceId,
      sourceType: "email_message",
      sourceId: email.id,
      emailThreadId: email.threadId,
      processedAt: now,
      modelName: item.modelName ?? modelId,
      extractionVersion: settings.extractionVersion,
      skillVersionId: null,
      contentHash: null,
      rawExtractionJson: JSON.stringify(document),
      aiUsageJson: null,
      totalInputTokens: item.usage?.inputTokens ?? 0,
      totalOutputTokens: item.usage?.outputTokens ?? 0,
      totalCostUsd: String(item.costUsd ?? 0),
      processingDurationMs: null,
      triggeredByUserId: null,
    });

    await persistExtractionDocument({
      sourceId,
      emailThreadId: email.threadId,
      document,
      calendarOnly: true,
    });

    if (harvestRow[0]) {
      await db
        .update(eventHighlightExtractions)
        .set({ persistSourceId: sourceId, updatedAt: now })
        .where(eq(eventHighlightExtractions.id, harvestRow[0].id));
    }

    if (email.threadId) threadIds.add(email.threadId);
  }

  await replayEventHarvestMutationsUnlocked(modelId);
  await collapseDuplicateScheduledCalendarMeetings();

  for (const threadId of threadIds) {
    try {
      await reconcileThreadCalendar({
        threadId,
        modelName: settings.analysisModel,
      });
    } catch (error) {
      console.error("[event-harvest:calendar-reconcile]", {
        threadId,
        error:
          error instanceof Error
            ? error.message
            : "Calendar reconciliation failed",
      });
    }
  }
}

export async function loadEventHighlightRuns(
  emailIds: string[],
): Promise<Partial<Record<EventHighlightModelId, EventHighlightModelRun>>> {
  const normalized = [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select()
    .from(eventHighlightExtractions)
    .where(inArray(eventHighlightExtractions.emailId, normalized));

  const byModel = new Map<
    EventHighlightModelId,
    Array<{
      emailId: string;
      extraction: EventHighlightExtraction;
      skipped: boolean;
      error: string | null;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
      apiModelName: string | null;
    }>
  >();

  for (const row of rows) {
    if (!(EVENT_HIGHLIGHT_MODELS as readonly string[]).includes(row.modelId)) {
      continue;
    }
    const modelId = row.modelId as EventHighlightModelId;
    let extraction = emptyEventHighlightExtraction();
    try {
      extraction = parseEventHighlightExtraction(JSON.parse(row.extractionJson));
    } catch {
      extraction = emptyEventHighlightExtraction();
    }
    const bucket = byModel.get(modelId) ?? [];
    bucket.push({
      emailId: row.emailId,
      extraction,
      skipped: row.skipped,
      error: row.error,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      totalTokens: row.totalTokens ?? 0,
      costUsd: row.costUsd ? Number(row.costUsd) : 0,
      apiModelName: row.apiModelName,
    });
    byModel.set(modelId, bucket);
  }

  const runs: Partial<Record<EventHighlightModelId, EventHighlightModelRun>> =
    {};
  for (const [modelId, modelRows] of byModel) {
    runs[modelId] = buildPassRun(modelId, modelRows);
  }
  return runs;
}

export async function deleteEventHighlightExtractions(
  emailIds: string[],
  modelId: EventHighlightModelId,
): Promise<void> {
  const normalized = [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return;

  const db = getDb();
  await db
    .delete(eventHighlightExtractions)
    .where(
      and(
        inArray(eventHighlightExtractions.emailId, normalized),
        eq(eventHighlightExtractions.modelId, modelId),
      ),
    );
}
