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
import { storeParsedMessage } from "./store";

export type BackfillTrigger = "manual" | "backfill";

export type BackfillResult = {
  syncRunId: string;
  messagesAdded: number;
  messagesSkipped: number;
  errors: string[];
};

async function listMatchingThreadIds(
  gmail: gmail_v1.Gmail,
  query: string,
): Promise<string[]> {
  const threadIds = new Set<string>();
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
      pageToken,
    });

    for (const message of response.data.messages ?? []) {
      if (message.threadId) threadIds.add(message.threadId);
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return [...threadIds];
}

async function importThread(
  gmail: gmail_v1.Gmail,
  threadId: string,
  syncRunId: string,
  cutoffDate?: string,
): Promise<{ added: number; skipped: number; errors: string[] }> {
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
          cutoffDate &&
          !isMessageOnOrBeforeCutoff(parsed.receivedAt, cutoffDate)
        ) {
          skipped += 1;
          continue;
        }

        const result = await storeParsedMessage({
          parsed,
          source: "personal_backfill",
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

export async function backfillPersonalAccount(options?: {
  senderEmail?: string;
  /** ISO date (YYYY-MM-DD); only import mail received on or before this day. */
  cutoffDate?: string;
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

    if (options?.cutoffDate) {
      query = appendBackfillCutoffToQuery(query, options.cutoffDate);
    }

    const { gmail } = await getGmailClient("personal_backfill");
    const threadIds = await listMatchingThreadIds(gmail, query);

    for (const threadId of threadIds) {
      const result = await importThread(
        gmail,
        threadId,
        syncRunId,
        options?.cutoffDate,
      );
      messagesAdded += result.added;
      messagesSkipped += result.skipped;
      errors.push(...result.errors);
    }
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
