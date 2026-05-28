import { randomUUID } from "crypto";

import { count, eq } from "drizzle-orm";
import type { gmail_v1 } from "googleapis";

import { getDb } from "@/lib/db";
import { emails, gmailConnections, syncRuns } from "@/lib/db/schema";

import { getGmailClient } from "./client";
import { parseGmailMessage } from "./messages";
import { DEDICATED_INITIAL_SYNC_QUERY } from "./queries";
import { storeParsedMessage } from "./store";
import { assertDedicatedConnectionValid } from "./verify";

export type SyncTrigger = "cron" | "manual";

export type SyncResult = {
  syncRunId: string;
  messagesAdded: number;
  messagesSkipped: number;
  errors: string[];
};

let dedicatedSyncInProgress = false;

async function needsInitialDedicatedImport(): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ count: count() })
    .from(emails)
    .where(eq(emails.source, "dedicated"));
  return (row?.count ?? 0) === 0;
}

async function fetchFullMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<ReturnType<typeof parseGmailMessage>> {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return parseGmailMessage(response.data);
}

async function syncMessageIds(
  gmail: gmail_v1.Gmail,
  messageIds: string[],
  syncRunId: string,
): Promise<{ added: number; skipped: number; errors: string[] }> {
  let added = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const messageId of messageIds) {
    try {
      const parsed = await fetchFullMessage(gmail, messageId);
      if (!parsed) {
        skipped += 1;
        continue;
      }

      const result = await storeParsedMessage({
        parsed,
        source: "dedicated",
        syncRunId,
      });

      if (result === "added") added += 1;
      else skipped += 1;
    } catch (error) {
      errors.push(
        `Message ${messageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { added, skipped, errors };
}

async function listAllMessageIds(
  gmail: gmail_v1.Gmail,
  query: string,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
      pageToken,
    });

    for (const message of response.data.messages ?? []) {
      if (message.id) ids.push(message.id);
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return ids;
}

async function syncViaHistory(
  gmail: gmail_v1.Gmail,
  startHistoryId: string,
  syncRunId: string,
): Promise<{ added: number; skipped: number; errors: string[]; historyId: string | null }> {
  const messageIds = new Set<string>();
  let latestHistoryId: string | null = null;
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
      pageToken,
    });

    latestHistoryId = response.data.historyId ?? latestHistoryId;

    for (const record of response.data.history ?? []) {
      for (const added of record.messagesAdded ?? []) {
        if (added.message?.id) messageIds.add(added.message.id);
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  const result = await syncMessageIds(gmail, [...messageIds], syncRunId);
  return { ...result, historyId: latestHistoryId };
}

async function saveHistoryId(historyId: string) {
  const db = getDb();
  await db
    .update(gmailConnections)
    .set({
      lastHistoryId: historyId,
      lastSyncAt: new Date().toISOString(),
    })
    .where(eq(gmailConnections.accountType, "dedicated"));
}

function isExpiredHistoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("404") || message.toLowerCase().includes("history");
}

export async function syncDedicatedAccount(
  trigger: SyncTrigger,
): Promise<SyncResult> {
  if (dedicatedSyncInProgress) {
    throw new Error(
      "A dedicated sync is already running. Wait for it to finish before starting another.",
    );
  }

  const verification = await assertDedicatedConnectionValid();

  dedicatedSyncInProgress = true;

  const db = getDb();
  const syncRunId = randomUUID();
  const startedAt = new Date().toISOString();

  await db.insert(syncRuns).values({
    id: syncRunId,
    accountType: "dedicated",
    trigger,
    startedAt,
    messagesAdded: 0,
    messagesSkipped: 0,
    errors: null,
  });

  const errors: string[] = [];
  let messagesAdded = 0;
  let messagesSkipped = 0;

  try {
    const { gmail } = verification;
    const { connection } = await getGmailClient("dedicated");
    const initialImport = await needsInitialDedicatedImport();

    if (initialImport) {
      const profile = await gmail.users.getProfile({ userId: "me" });
      const messageIds = await listAllMessageIds(
        gmail,
        DEDICATED_INITIAL_SYNC_QUERY,
      );
      const initialResult = await syncMessageIds(gmail, messageIds, syncRunId);
      messagesAdded += initialResult.added;
      messagesSkipped += initialResult.skipped;
      errors.push(...initialResult.errors);

      if (profile.data.historyId) {
        await saveHistoryId(profile.data.historyId);
      }
    } else if (connection.lastHistoryId) {
      try {
        const historyResult = await syncViaHistory(
          gmail,
          connection.lastHistoryId,
          syncRunId,
        );
        messagesAdded += historyResult.added;
        messagesSkipped += historyResult.skipped;
        errors.push(...historyResult.errors);

        if (historyResult.historyId) {
          await saveHistoryId(historyResult.historyId);
        }
      } catch (historyError) {
        if (!isExpiredHistoryError(historyError)) {
          throw historyError;
        }

        const profile = await gmail.users.getProfile({ userId: "me" });
        if (profile.data.historyId) {
          await saveHistoryId(profile.data.historyId);
        }
      }
    } else {
      const profile = await gmail.users.getProfile({ userId: "me" });
      if (profile.data.historyId) {
        await saveHistoryId(profile.data.historyId);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    dedicatedSyncInProgress = false;
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
