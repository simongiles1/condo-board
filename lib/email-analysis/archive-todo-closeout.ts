/**
 * One-time / on-demand close-out for harvests older than the working window.
 * Persist used to skip LLM reconcile on stale rows; Archive still needs
 * completed vs still-open inside that older set.
 */

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import {
  closeCrossThreadCalendarInvitesForEmails,
  reconcileThreadActionItems,
} from "@/lib/email-analysis/action-item-reconciliation";
import { getDb } from "@/lib/db";
import {
  emails,
  extractedActionItems,
  extractionSources,
} from "@/lib/db/schema";
import {
  todoWorkingWindowCutoffIso,
  UNRESOLVED_TODO_LIFECYCLE_STATUSES,
} from "@/lib/email-analysis/todo-lifecycle";

export type ArchiveTodoCloseoutProgress = {
  threadId: string;
  index: number;
  total: number;
  completed: number;
  superseded: number;
  costUsd: number;
  error?: string;
};

export type ArchiveTodoCloseoutResult = {
  threadCount: number;
  completed: number;
  superseded: number;
  failedThreads: number;
  calendarClosed: number;
  costUsd: number;
};

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await mapper(items[index], index);
    }
  }
  const pool = Math.min(Math.max(1, concurrency), items.length || 1);
  await Promise.all(Array.from({ length: pool }, () => worker()));
}

/** Threads that still have unresolved harvests sourced before the working window. */
export async function listArchiveCloseoutThreadIds(
  now = new Date(),
): Promise<string[]> {
  const db = getDb();
  const cutoff = todoWorkingWindowCutoffIso(now);
  const rows = await db
    .selectDistinct({ threadId: extractedActionItems.emailThreadId })
    .from(extractedActionItems)
    .innerJoin(
      extractionSources,
      eq(extractedActionItems.sourceId, extractionSources.id),
    )
    .innerJoin(emails, eq(extractionSources.sourceId, emails.id))
    .where(
      and(
        eq(extractedActionItems.completed, false),
        inArray(
          extractedActionItems.lifecycleStatus,
          [...UNRESOLVED_TODO_LIFECYCLE_STATUSES],
        ),
        isNotNull(extractedActionItems.emailThreadId),
        eq(extractionSources.sourceType, "email_message"),
        lt(emails.receivedAt, cutoff),
      ),
    );

  return rows
    .map((row) => row.threadId)
    .filter((id): id is string => Boolean(id));
}

export async function runArchiveTodoCloseout(options: {
  modelName: string;
  concurrency?: number;
  onProgress?: (progress: ArchiveTodoCloseoutProgress) => void;
  now?: Date;
}): Promise<ArchiveTodoCloseoutResult> {
  const concurrency = options.concurrency ?? 4;
  const threadIds = await listArchiveCloseoutThreadIds(options.now);
  let completed = 0;
  let superseded = 0;
  let failedThreads = 0;
  let costUsd = 0;

  await mapWithConcurrency(threadIds, concurrency, async (threadId, index) => {
    try {
      const result = await reconcileThreadActionItems({
        threadId,
        modelName: options.modelName,
      });
      completed += result.completed;
      superseded += result.superseded;
      costUsd += result.costUsd;
      options.onProgress?.({
        threadId,
        index: index + 1,
        total: threadIds.length,
        completed: result.completed,
        superseded: result.superseded,
        costUsd: result.costUsd,
      });
    } catch (error) {
      failedThreads += 1;
      const message =
        error instanceof Error ? error.message : "Archive close-out failed.";
      options.onProgress?.({
        threadId,
        index: index + 1,
        total: threadIds.length,
        completed: 0,
        superseded: 0,
        costUsd: 0,
        error: message,
      });
    }
  });

  const db = getDb();
  const emailRows = await db.select({ id: emails.id }).from(emails);
  const calendarClosed = await closeCrossThreadCalendarInvitesForEmails(
    emailRows.map((row) => row.id),
  );

  return {
    threadCount: threadIds.length,
    completed,
    superseded,
    failedThreads,
    calendarClosed,
    costUsd,
  };
}
