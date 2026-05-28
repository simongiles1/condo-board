import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { analysisQueue, emails, extractionSources } from "@/lib/db/schema";

import type {
  EmailProcessingStats,
  InboxAnalysisQueueState,
  ProcessedEmailSnapshot,
} from "./processing-stats";

export type {
  EmailProcessingStats,
  InboxAnalysisQueueState,
  ProcessedEmailSnapshot,
} from "./processing-stats";
export { mergeLiveProcessingStats, sumProcessingStats } from "./processing-stats";

export async function loadInboxAnalysisQueueState(
  emailIds: string[],
): Promise<InboxAnalysisQueueState> {
  if (emailIds.length === 0) {
    return {
      processingEmailIds: [],
      pendingEmailIds: [],
      failedEmails: [],
      processedEmails: [],
    };
  }

  const db = getDb();
  const rows = await db
    .select({
      unitId: analysisQueue.unitId,
      status: analysisQueue.status,
      error: analysisQueue.error,
    })
    .from(analysisQueue)
    .where(
      and(
        eq(analysisQueue.unitType, "email_message"),
        inArray(analysisQueue.unitId, emailIds),
        inArray(analysisQueue.status, ["pending", "processing", "failed"]),
      ),
    );

  const processingEmailIds: string[] = [];
  const pendingEmailIds: string[] = [];
  const failedByEmail = new Map<string, string>();

  for (const row of rows) {
    if (row.status === "processing") {
      processingEmailIds.push(row.unitId);
    } else if (row.status === "pending") {
      pendingEmailIds.push(row.unitId);
    } else if (row.status === "failed" && row.error) {
      failedByEmail.set(row.unitId, row.error);
    }
  }

  if (failedByEmail.size > 0) {
    const succeeded = await db
      .select({ id: emails.id })
      .from(emails)
      .where(
        and(
          inArray(emails.id, [...failedByEmail.keys()]),
          isNotNull(emails.processedAt),
        ),
      );

    for (const row of succeeded) {
      failedByEmail.delete(row.id);
    }
  }

  const activeEmailIds = new Set([...processingEmailIds, ...pendingEmailIds]);

  const processedRows = await db
    .select({
      id: emails.id,
      processedAt: emails.processedAt,
    })
    .from(emails)
    .where(and(inArray(emails.id, emailIds), isNotNull(emails.processedAt)));

  const completedProcessedIds = processedRows
    .filter((row) => row.processedAt && !activeEmailIds.has(row.id))
    .map((row) => row.id);

  const stats = await loadMessageProcessingStats(completedProcessedIds);

  return {
    processingEmailIds,
    pendingEmailIds,
    failedEmails: [...failedByEmail.entries()].map(([emailId, error]) => ({
      emailId,
      error,
    })),
    processedEmails: processedRows
      .filter((row) => row.processedAt && !activeEmailIds.has(row.id))
      .map((row) => {
        const entry = stats[row.id];
        return {
          emailId: row.id,
          processedAt: row.processedAt!,
          processingCostUsd: entry?.costUsd ?? null,
          inputTokens: entry?.inputTokens ?? null,
          outputTokens: entry?.outputTokens ?? null,
          processingDurationMs: entry?.processingDurationMs ?? null,
        };
      }),
  };
}

/** @deprecated Use loadInboxAnalysisQueueState */
export async function loadActiveProcessingEmailIds(
  emailIds: string[],
): Promise<string[]> {
  const state = await loadInboxAnalysisQueueState(emailIds);
  return [...state.processingEmailIds, ...state.pendingEmailIds];
}

export async function loadMessageProcessingStats(
  emailIds: string[],
): Promise<Record<string, Omit<EmailProcessingStats, "subject" | "fromAddress" | "receivedAt" | "processedAt"> & { processedAt: string | null }>> {
  if (emailIds.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select({
      emailId: extractionSources.sourceId,
      costUsd: extractionSources.totalCostUsd,
      inputTokens: extractionSources.totalInputTokens,
      outputTokens: extractionSources.totalOutputTokens,
      processingDurationMs: extractionSources.processingDurationMs,
      processedAt: extractionSources.processedAt,
    })
    .from(extractionSources)
    .where(
      and(
        eq(extractionSources.sourceType, "email_message"),
        inArray(extractionSources.sourceId, emailIds),
      ),
    );

  const stats: Record<
    string,
    Omit<EmailProcessingStats, "subject" | "fromAddress" | "receivedAt"> & {
      processedAt: string | null;
    }
  > = {};
  for (const row of rows) {
    stats[row.emailId] = {
      emailId: row.emailId,
      processedAt: row.processedAt,
      costUsd: Number(row.costUsd),
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      processingDurationMs: row.processingDurationMs ?? null,
    };
  }
  return stats;
}

export async function loadMessageProcessingCosts(
  emailIds: string[],
): Promise<Record<string, number>> {
  const stats = await loadMessageProcessingStats(emailIds);
  const costs: Record<string, number> = {};
  for (const [emailId, entry] of Object.entries(stats)) {
    if (entry.costUsd != null) {
      costs[emailId] = entry.costUsd;
    }
  }
  return costs;
}

export async function loadThreadProcessingCosts(
  threadIds: string[],
): Promise<Record<string, number>> {
  if (threadIds.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select({
      threadId: extractionSources.emailThreadId,
      totalCostUsd: extractionSources.totalCostUsd,
    })
    .from(extractionSources)
    .where(inArray(extractionSources.emailThreadId, threadIds));

  const costs: Record<string, number> = {};
  for (const row of rows) {
    if (!row.threadId) continue;
    costs[row.threadId] =
      (costs[row.threadId] ?? 0) + Number(row.totalCostUsd);
  }
  return costs;
}

export async function loadThreadProcessingDetails(
  threadIds: string[],
): Promise<Record<string, EmailProcessingStats[]>> {
  if (threadIds.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select({
      threadId: emails.threadId,
      emailId: emails.id,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      processedAt: emails.processedAt,
      costUsd: extractionSources.totalCostUsd,
      inputTokens: extractionSources.totalInputTokens,
      outputTokens: extractionSources.totalOutputTokens,
      processingDurationMs: extractionSources.processingDurationMs,
    })
    .from(emails)
    .leftJoin(
      extractionSources,
      and(
        eq(extractionSources.sourceId, emails.id),
        eq(extractionSources.sourceType, "email_message"),
      ),
    )
    .where(inArray(emails.threadId, threadIds))
    .orderBy(asc(emails.receivedAt));

  const map: Record<string, EmailProcessingStats[]> = {};
  for (const row of rows) {
    if (!row.threadId) continue;
    const list = map[row.threadId] ?? [];
    list.push({
      emailId: row.emailId,
      subject: row.subject,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
      costUsd: row.costUsd != null ? Number(row.costUsd) : null,
      inputTokens: row.inputTokens ?? null,
      outputTokens: row.outputTokens ?? null,
      processingDurationMs: row.processingDurationMs ?? null,
    });
    map[row.threadId] = list;
  }
  return map;
}

export async function loadThreadEmailIds(
  threadIds: string[],
): Promise<Record<string, string[]>> {
  if (threadIds.length === 0) return {};

  const db = getDb();
  const rows = await db
    .select({ id: emails.id, threadId: emails.threadId })
    .from(emails)
    .where(inArray(emails.threadId, threadIds))
    .orderBy(asc(emails.receivedAt));

  const map: Record<string, string[]> = {};
  for (const row of rows) {
    if (!row.threadId) continue;
    const ids = map[row.threadId] ?? [];
    ids.push(row.id);
    map[row.threadId] = ids;
  }
  return map;
}
