import { asc, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  contactHighlightExtractions,
  emails,
  emailThreads,
  eventHighlightExtractions,
  organizationHighlightExtractions,
  todoHighlightExtractions,
} from "@/lib/db/schema";
import type {
  BulkExtractKind,
  BulkExtractTarget,
} from "@/lib/email-analysis/bulk-extract-runs";

export type ExtractTargetThread = {
  id: string;
  subject: string | null;
  lastMessageAt: string;
};

export type ExtractTargetEmail = {
  id: string;
  threadId: string | null;
  subject: string;
  receivedAt: string;
};

export type ExtractTargetPrepareMode = "thread" | "emails";

/** Successful harvest row: calendar and drip both treat `error is null` as extracted. */
export function isSuccessfulHarvestRow(
  error: string | null | undefined,
): boolean {
  return error == null;
}

export function filterEmailsMissingHarvest<T extends { id: string }>(
  emailRows: T[],
  successfulEmailIds: Iterable<string>,
): T[] {
  const done = new Set(successfulEmailIds);
  return emailRows.filter((row) => !done.has(row.id));
}

/**
 * Group emails into extract targets: one job per thread (oldest thread first),
 * then orphan emails (no thread) oldest first.
 */
export function groupEmailsIntoExtractTargets(
  threadRows: ExtractTargetThread[],
  emailRows: ExtractTargetEmail[],
  prepareMode: ExtractTargetPrepareMode = "thread",
): BulkExtractTarget[] {
  const emailsByThread = new Map<string, string[]>();
  const orphans: Array<{ id: string; subject: string; receivedAt: string }> =
    [];

  for (const row of emailRows) {
    if (!row.threadId) {
      orphans.push({
        id: row.id,
        subject: row.subject,
        receivedAt: row.receivedAt,
      });
      continue;
    }
    const list = emailsByThread.get(row.threadId) ?? [];
    list.push(row.id);
    emailsByThread.set(row.threadId, list);
  }

  const targets: BulkExtractTarget[] = [];

  for (const thread of threadRows) {
    const emailIds = emailsByThread.get(thread.id) ?? [];
    if (emailIds.length === 0) continue;
    targets.push({
      progressKey: thread.id,
      threadId: thread.id,
      subject: thread.subject?.trim() || "(no subject)",
      emailIds,
      prepareQuery:
        prepareMode === "emails"
          ? `emailIds=${encodeURIComponent(emailIds.join(","))}`
          : `threadId=${encodeURIComponent(thread.id)}`,
    });
  }

  orphans.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (const orphan of orphans) {
    targets.push({
      progressKey: orphan.id,
      threadId: null,
      subject: orphan.subject?.trim() || "(no subject)",
      emailIds: [orphan.id],
      prepareQuery: `emailIds=${encodeURIComponent(orphan.id)}`,
    });
  }

  return targets;
}

function summarizeTargets(targets: BulkExtractTarget[]): {
  targets: BulkExtractTarget[];
  totalThreads: number;
  totalEmails: number;
} {
  const totalEmails = targets.reduce((sum, t) => sum + t.emailIds.length, 0);
  return {
    targets,
    totalThreads: targets.length,
    totalEmails,
  };
}

/**
 * All inbox threads (and orphan emails) as extract targets, oldest thread first.
 * Matches the select→bulk extract grouping: one 4-pass job per thread.
 */
export async function listBulkExtractTargets(): Promise<{
  targets: BulkExtractTarget[];
  totalThreads: number;
  totalEmails: number;
}> {
  const { threadRows, emailRows } = await loadExtractTargetRows();
  return summarizeTargets(groupEmailsIntoExtractTargets(threadRows, emailRows));
}

/**
 * Threads/orphans that still have at least one email without a successful
 * harvest row for `kind`. Target `emailIds` are only the missing messages so
 * drip does not re-LLM the rest of the thread.
 */
export async function listMissingExtractTargets(
  kind: BulkExtractKind,
): Promise<{
  targets: BulkExtractTarget[];
  totalThreads: number;
  totalEmails: number;
}> {
  const { threadRows, emailRows } = await loadExtractTargetRows();
  const successfulIds = await loadSuccessfulHarvestEmailIds(kind);
  const missingRows = filterEmailsMissingHarvest(emailRows, successfulIds);
  return summarizeTargets(
    groupEmailsIntoExtractTargets(threadRows, missingRows, "emails"),
  );
}

async function loadExtractTargetRows(): Promise<{
  threadRows: ExtractTargetThread[];
  emailRows: ExtractTargetEmail[];
}> {
  const db = getDb();

  const threadRows = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      lastMessageAt: emailThreads.lastMessageAt,
    })
    .from(emailThreads)
    .orderBy(asc(emailThreads.lastMessageAt));

  const emailRows = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
    })
    .from(emails)
    .orderBy(asc(emails.receivedAt));

  return { threadRows, emailRows };
}

async function loadSuccessfulHarvestEmailIds(
  kind: BulkExtractKind,
): Promise<string[]> {
  const db = getDb();

  if (kind === "contacts") {
    const rows = await db
      .selectDistinct({ emailId: contactHighlightExtractions.emailId })
      .from(contactHighlightExtractions)
      .where(isNull(contactHighlightExtractions.error));
    return rows.map((row) => row.emailId);
  }
  if (kind === "organizations") {
    const rows = await db
      .selectDistinct({ emailId: organizationHighlightExtractions.emailId })
      .from(organizationHighlightExtractions)
      .where(isNull(organizationHighlightExtractions.error));
    return rows.map((row) => row.emailId);
  }
  if (kind === "events") {
    const rows = await db
      .selectDistinct({ emailId: eventHighlightExtractions.emailId })
      .from(eventHighlightExtractions)
      .where(isNull(eventHighlightExtractions.error));
    return rows.map((row) => row.emailId);
  }

  const rows = await db
    .selectDistinct({ emailId: todoHighlightExtractions.emailId })
    .from(todoHighlightExtractions)
    .where(isNull(todoHighlightExtractions.error));
  return rows.map((row) => row.emailId);
}
