import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";
import type { gmail_v1 } from "googleapis";

import { getDb } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";

import { getGmailClient } from "./client";
import { parseGmailMessage } from "./messages";
import {
  appendBackfillCutoffToQuery,
  buildAllowlistQuery,
  buildSenderBackfillQuery,
  getAllowlistEmails,
  isMessageOnOrBeforeCutoff,
} from "./queries";
import { storeParsedMessage, type EmailSource } from "./store";
import { listMatchingThreadIds } from "./thread-search";

export type BackfillTrigger = "manual" | "backfill";

export type BackfillResult = {
  syncRunId: string;
  messagesAdded: number;
  messagesSkipped: number;
  errors: string[];
};

export type ImportThreadResult = {
  added: number;
  skipped: number;
  errors: string[];
};

/**
 * Import every message in a Gmail thread. No per-message allowlist filter —
 * callers decide whether the thread qualifies (any allowlisted participant).
 */
export async function importGmailThread(
  gmail: gmail_v1.Gmail,
  threadId: string,
  syncRunId: string,
  source: EmailSource,
  options?: { cutoffAt?: string },
): Promise<ImportThreadResult> {
  let added = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const response = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full",
    });

    for (const message of response.data.messages ?? []) {
      try {
        const parsed = parseGmailMessage(message);
        if (!parsed) {
          skipped += 1;
          continue;
        }

        if (
          options?.cutoffAt &&
          !isMessageOnOrBeforeCutoff(parsed.receivedAt, options.cutoffAt)
        ) {
          skipped += 1;
          continue;
        }

        const result = await storeParsedMessage({
          parsed,
          source,
          syncRunId,
        });

        if (result === "added") added += 1;
        else skipped += 1;
      } catch (error) {
        errors.push(
          `Thread ${threadId} message ${message.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    errors.push(
      `Thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { added, skipped, errors };
}

/** Find allowlist-matching threads, then import every message in each thread. */
export async function importThreadsMatchingQuery(
  gmail: gmail_v1.Gmail,
  query: string,
  syncRunId: string,
  source: EmailSource,
  options?: { cutoffAt?: string },
): Promise<ImportThreadResult> {
  let added = 0;
  let skipped = 0;
  const errors: string[] = [];

  const threadIds = await listMatchingThreadIds(gmail, query);

  for (const threadId of threadIds) {
    const result = await importGmailThread(
      gmail,
      threadId,
      syncRunId,
      source,
      options,
    );
    added += result.added;
    skipped += result.skipped;
    errors.push(...result.errors);
  }

  return { added, skipped, errors };
}

export async function backfillPersonalAccount(options?: {
  senderEmail?: string;
  /** ISO timestamp; only import mail received on or before this instant. */
  cutoffAt?: string;
}): Promise<BackfillResult> {
  const db = getDb();
  const syncRunId = randomUUID();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let messagesAdded = 0;
  let messagesSkipped = 0;

  await db.insert(syncRuns).values({
    id: syncRunId,
    accountType: "personal_backfill",
    trigger: "backfill",
    startedAt,
    messagesAdded: 0,
    messagesSkipped: 0,
    errors: null,
  });

  try {
    let query = options?.senderEmail
      ? buildSenderBackfillQuery(options.senderEmail)
      : buildAllowlistQuery(await getAllowlistEmails());

    if (options?.cutoffAt) {
      query = appendBackfillCutoffToQuery(query, options.cutoffAt);
    }

    const { gmail } = await getGmailClient("personal_backfill");
    const result = await importThreadsMatchingQuery(
      gmail,
      query,
      syncRunId,
      "personal_backfill",
      { cutoffAt: options?.cutoffAt },
    );
    messagesAdded = result.added;
    messagesSkipped = result.skipped;
    errors.push(...result.errors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  await db
    .update(syncRuns)
    .set({
      finishedAt: new Date().toISOString(),
      messagesAdded,
      messagesSkipped,
      errors: errors.length > 0 ? errors.join("\n") : null,
    })
    .where(eq(syncRuns.id, syncRunId));

  return {
    syncRunId,
    messagesAdded,
    messagesSkipped,
    errors,
  };
}
