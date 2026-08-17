import { randomUUID } from "crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { semanticDeduplicateIncomingActionItems } from "@/lib/email-analysis/action-item-dedup";
import {
  closeCrossThreadCalendarInvitesForEmails,
  reconcileThreadActionItems,
} from "@/lib/email-analysis/action-item-reconciliation";
import { getDb } from "@/lib/db";
import {
  emails,
  extractedActionItems,
  extractionSources,
  todoHighlightExtractions,
} from "@/lib/db/schema";
import { deleteExtractionEntities } from "@/lib/email-analysis/persist";
import { getAnalysisSettings } from "@/lib/email-analysis/settings";
import {
  completedFieldsForLifecycle,
  lifecycleStatusForReceivedAt,
} from "@/lib/email-analysis/todo-lifecycle";
import {
  TODO_HIGHLIGHT_MODELS,
  type TodoHighlightModelId,
} from "@/lib/email-analysis/todo-highlight-models";
import {
  emptyTodoHighlightExtraction,
  parseTodoHighlightExtraction,
  todoHighlightHasAny,
  type TodoHighlightExtraction,
} from "@/lib/email-analysis/todo-highlight-shared";
import { upsertEmailGlobalTodos } from "@/lib/todos/sync-email-global-todos";

export type TodoHighlightModelRun = {
  extractions: Record<string, TodoHighlightExtraction>;
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
    itemCount: number;
  };
};

type SaveItem = {
  emailId: string;
  extraction: TodoHighlightExtraction;
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

function actionItemDedupKey(
  assignee: string,
  task: string,
  deadline?: string,
): string {
  return [assignee, task, deadline]
    .filter((part) => part != null && String(part).trim())
    .map((part) => String(part).trim().toLowerCase())
    .join("|");
}

function buildPassRun(
  modelId: TodoHighlightModelId,
  rows: Array<{
    emailId: string;
    extraction: TodoHighlightExtraction;
    skipped: boolean;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    apiModelName: string | null;
  }>,
): TodoHighlightModelRun {
  const extractions: Record<string, TodoHighlightExtraction> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let apiModelName: string = modelId;
  let extracted = 0;
  let skipped = 0;
  let failed = 0;
  let itemCount = 0;

  for (const row of rows) {
    extractions[row.emailId] = row.extraction;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    totalTokens += row.totalTokens;
    costUsd += row.costUsd;
    if (row.apiModelName) apiModelName = row.apiModelName;
    if (row.error) failed += 1;
    else if (row.skipped) skipped += 1;
    else if (todoHighlightHasAny(row.extraction)) extracted += 1;
    else skipped += 1;
    itemCount += row.extraction.action_items.length;
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
      itemCount,
    },
  };
}

export async function saveTodoHighlightExtractions(
  modelId: TodoHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  for (const item of items) {
    const emailId = item.emailId.trim();
    if (!emailId) continue;

    const extractionJson = JSON.stringify(
      item.extraction ?? emptyTodoHighlightExtraction(),
    );
    const inputTokens = item.usage?.inputTokens ?? null;
    const outputTokens = item.usage?.outputTokens ?? null;
    const totalTokens = item.usage?.totalTokens ?? null;
    const costUsd = item.costUsd != null ? String(item.costUsd) : null;

    const existing = await db
      .select({
        id: todoHighlightExtractions.id,
        persistSourceId: todoHighlightExtractions.persistSourceId,
      })
      .from(todoHighlightExtractions)
      .where(
        and(
          eq(todoHighlightExtractions.emailId, emailId),
          eq(todoHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(todoHighlightExtractions)
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
        .where(eq(todoHighlightExtractions.id, existing[0].id));
    } else {
      await db.insert(todoHighlightExtractions).values({
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

const withTodoPersistLock = createAsyncMutex();

function parseHarvestExtraction(json: string): TodoHighlightExtraction {
  try {
    return parseTodoHighlightExtraction(JSON.parse(json));
  } catch {
    return emptyTodoHighlightExtraction();
  }
}

/**
 * Persist harvested action items in email receivedAt order. Source emails
 * inside the working window become open (with thread dedup + reconcile).
 * Older emails are stored as stale; thread close-out still runs so Archive
 * can split remaining open asks from items the thread already resolved.
 */
export async function persistTodoHarvestActionItems(
  modelId: TodoHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  return withTodoPersistLock(() =>
    persistTodoHarvestActionItemsUnlocked(modelId, items),
  );
}

/**
 * After a bulk to-dos run: persist this run's emails plus any harvests that
 * never got a product source (crash/cancel mid-run), in receivedAt order.
 */
export async function persistTodoHarvestsAfterBulkRun(
  modelId: TodoHighlightModelId,
  processedEmailIds: string[],
): Promise<void> {
  return withTodoPersistLock(async () => {
    const items = await loadSaveItemsForBulkPersist(modelId, processedEmailIds);
    await persistTodoHarvestActionItemsUnlocked(modelId, items);
  });
}

async function loadSaveItemsForBulkPersist(
  modelId: TodoHighlightModelId,
  processedEmailIds: string[],
): Promise<SaveItem[]> {
  const processed = new Set(
    processedEmailIds.map((id) => id.trim()).filter(Boolean),
  );
  const db = getDb();
  const rows = await db
    .select()
    .from(todoHighlightExtractions)
    .where(eq(todoHighlightExtractions.modelId, modelId));

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

async function persistTodoHarvestActionItemsUnlocked(
  modelId: TodoHighlightModelId,
  items: SaveItem[],
): Promise<void> {
  const persistable = items.filter(
    (item) => item.emailId.trim() && !item.skipped && !item.error,
  );
  if (persistable.length === 0) return;

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
  const closeOutModel =
    ordered.find((entry) => entry.item.modelName)?.item.modelName ??
    settings.analysisModel;
  const reconcileThreadIds = new Set<string>();
  const harvestedEmailIdsForInvites: string[] = [];

  for (const { item, email } of ordered) {
    const harvestRow = await db
      .select({
        id: todoHighlightExtractions.id,
        persistSourceId: todoHighlightExtractions.persistSourceId,
      })
      .from(todoHighlightExtractions)
      .where(
        and(
          eq(todoHighlightExtractions.emailId, email.id),
          eq(todoHighlightExtractions.modelId, modelId),
        ),
      )
      .limit(1);

    if (harvestRow[0]?.persistSourceId) {
      await deleteExtractionEntities(harvestRow[0].persistSourceId);
    }

    const extraction = item.extraction ?? emptyTodoHighlightExtraction();
    const lifecycleStatus = lifecycleStatusForReceivedAt(email.receivedAt);
    let insertItems = extraction.action_items;

    if (lifecycleStatus === "open" && email.threadId && insertItems.length) {
      try {
        const dedup = await semanticDeduplicateIncomingActionItems({
          threadId: email.threadId,
          newItems: insertItems,
          modelName: item.modelName ?? settings.analysisModel,
        });
        insertItems = dedup.insertItems;
      } catch (error) {
        console.error("[todo-harvest:action-item-dedup]", {
          emailId: email.id,
          threadId: email.threadId,
          error:
            error instanceof Error ? error.message : "Semantic dedup failed",
        });
      }
    }

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
      rawExtractionJson: JSON.stringify({ action_items: insertItems }),
      aiUsageJson: null,
      totalInputTokens: item.usage?.inputTokens ?? 0,
      totalOutputTokens: item.usage?.outputTokens ?? 0,
      totalCostUsd: String(item.costUsd ?? 0),
      processingDurationMs: null,
      triggeredByUserId: null,
    });

    const completedFields = completedFieldsForLifecycle(lifecycleStatus, now);
    for (const action of insertItems) {
      const key = actionItemDedupKey(
        action.assignee,
        action.task,
        action.deadline,
      );
      const existing = key
        ? await db
            .select({ id: extractedActionItems.id })
            .from(extractedActionItems)
            .where(eq(extractedActionItems.dedupKey, key))
            .limit(1)
        : [];
      if (existing.length) continue;

      const [inserted] = await db
        .insert(extractedActionItems)
        .values({
          id: randomUUID(),
          assignee: action.assignee,
          description: action.task,
          deadline: action.deadline ?? null,
          completed: completedFields.completed,
          completedAt: completedFields.completedAt,
          emailThreadId: email.threadId,
          sourceQuote: action.source_quote ?? null,
          sourceId,
          dedupKey: key || null,
          lifecycleStatus,
          createdAt: now,
        })
        .returning({ id: extractedActionItems.id });

      if (lifecycleStatus === "open" && inserted) {
        await upsertEmailGlobalTodos([
          {
            extractedActionItemId: inserted.id,
            assignee: action.assignee,
            description: action.task,
            deadline: action.deadline ?? null,
          },
        ]);
      }
    }

    if (harvestRow[0]) {
      await db
        .update(todoHighlightExtractions)
        .set({ persistSourceId: sourceId, updatedAt: now })
        .where(eq(todoHighlightExtractions.id, harvestRow[0].id));
    }

    if (email.threadId) {
      reconcileThreadIds.add(email.threadId);
    }
    harvestedEmailIdsForInvites.push(email.id);
  }

  for (const threadId of reconcileThreadIds) {
    try {
      await reconcileThreadActionItems({
        threadId,
        modelName: closeOutModel,
      });
    } catch (error) {
      console.error("[todo-harvest:action-item-reconcile]", {
        threadId,
        error:
          error instanceof Error
            ? error.message
            : "Action item reconciliation failed",
      });
    }
  }

  try {
    await closeCrossThreadCalendarInvitesForEmails(harvestedEmailIdsForInvites);
  } catch (error) {
    console.error("[todo-harvest:action-item-cross-thread]", {
      error:
        error instanceof Error
          ? error.message
          : "Cross-thread invite close failed",
    });
  }
}

export async function loadTodoHighlightRuns(
  emailIds: string[],
): Promise<Partial<Record<TodoHighlightModelId, TodoHighlightModelRun>>> {
  const normalized = [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select()
    .from(todoHighlightExtractions)
    .where(inArray(todoHighlightExtractions.emailId, normalized));

  const byModel = new Map<
    TodoHighlightModelId,
    Array<{
      emailId: string;
      extraction: TodoHighlightExtraction;
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
    if (!(TODO_HIGHLIGHT_MODELS as readonly string[]).includes(row.modelId)) {
      continue;
    }
    const modelId = row.modelId as TodoHighlightModelId;
    let extraction = emptyTodoHighlightExtraction();
    try {
      extraction = parseTodoHighlightExtraction(JSON.parse(row.extractionJson));
    } catch {
      extraction = emptyTodoHighlightExtraction();
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

  const runs: Partial<Record<TodoHighlightModelId, TodoHighlightModelRun>> =
    {};
  for (const [modelId, modelRows] of byModel) {
    runs[modelId] = buildPassRun(modelId, modelRows);
  }
  return runs;
}

export async function deleteTodoHighlightExtractions(
  emailIds: string[],
  modelId: TodoHighlightModelId,
): Promise<void> {
  const normalized = [
    ...new Set(emailIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) return;

  const db = getDb();
  await db
    .delete(todoHighlightExtractions)
    .where(
      and(
        inArray(todoHighlightExtractions.emailId, normalized),
        eq(todoHighlightExtractions.modelId, modelId),
      ),
    );
}
