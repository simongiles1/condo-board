import { randomUUID } from "crypto";

import { count, eq } from "drizzle-orm";
import type { gmail_v1 } from "googleapis";

import { getDb } from "@/lib/db";
import { emails, gmailConnections, syncRuns } from "@/lib/db/schema";
import { reconcileStaleSyncRuns } from "@/lib/email/sync-run-reconcile";

import { getGmailClient } from "./client";
import { parseGmailMessage } from "./messages";
import {
  buildAllowlistQuery,
  DEDICATED_INITIAL_SYNC_QUERY,
  getAllowlistEmails,
  parsedMessageMatchesAllowlist,
} from "./queries";
import { storeParsedMessage, type EmailSource } from "./store";
import {
  assertDedicatedConnectionValid,
  assertPersonalConnectionValid,
} from "./verify";

export type SyncTrigger = "cron" | "manual";

export type SyncResult = {
  syncRunId: string;
  messagesAdded: number;
  messagesSkipped: number;
  errors: string[];
};

let personalSyncInProgress = false;
let dedicatedSyncInProgress = false;

async function countEmailsBySource(source: EmailSource): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: count() })
    .from(emails)
    .where(eq(emails.source, source));
  return row?.count ?? 0;
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
  source: EmailSource,
  options?: { allowlistEmails?: string[] },
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

      if (
        options?.allowlistEmails &&
        !parsedMessageMatchesAllowlist(parsed, options.allowlistEmails)
      ) {
        console.log(
          `[gmail:sync] allowlist skip msgId=${messageId} from=${parsed.fromAddress} to=${parsed.toAddresses.join(",")} cc=${parsed.ccAddresses.join(",")}`,
        );
        skipped += 1;
        continue;
      }

      const result = await storeParsedMessage({
        parsed,
        source,
        syncRunId,
      });

      if (result === "added") {
        console.log(`[gmail:sync] added msgId=${messageId} from=${parsed.fromAddress}`);
        added += 1;
      } else {
        console.log(`[gmail:sync] duplicate skip msgId=${messageId}`);
        skipped += 1;
      }
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
  source: EmailSource,
  options?: { allowlistEmails?: string[] },
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

  console.log(
    `[gmail:sync:history] startHistoryId=${startHistoryId} latestHistoryId=${latestHistoryId} messageIds=${messageIds.size}`,
    [...messageIds],
  );

  const result = await syncMessageIds(
    gmail,
    [...messageIds],
    syncRunId,
    source,
    options,
  );
  return { ...result, historyId: latestHistoryId };
}

async function saveHistoryId(
  accountType: typeof gmailConnections.$inferSelect.accountType,
  historyId: string,
) {
  const db = getDb();
  await db
    .update(gmailConnections)
    .set({
      lastHistoryId: historyId,
      lastSyncAt: new Date().toISOString(),
    })
    .where(eq(gmailConnections.accountType, accountType));
}

function isExpiredHistoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("404") || message.toLowerCase().includes("history");
}

export async function syncPersonalAccount(
  trigger: SyncTrigger,
): Promise<SyncResult> {
  if (personalSyncInProgress) {
    throw new Error(
      "A personal Gmail sync is already running. Wait for it to finish before starting another.",
    );
  }

  const verification = await assertPersonalConnectionValid();
  const allowlistEmails = await getAllowlistEmails();
  if (allowlistEmails.length === 0) {
    throw new Error(
      "No senders on the allowlist. Save at least one sender before syncing.",
    );
  }

  personalSyncInProgress = true;

  const db = getDb();
  await reconcileStaleSyncRuns({ closeAllUnfinished: true });

  const syncRunId = randomUUID();
  const startedAt = new Date().toISOString();

  await db.insert(syncRuns).values({
    id: syncRunId,
    accountType: "personal_backfill",
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
    const { connection } = await getGmailClient("personal_backfill");

    if (!connection.lastHistoryId) {
      const existingPersonalMail = await countEmailsBySource("personal_backfill");

      // Snapshot historyId before the bulk fetch so that any emails arriving
      // during the (potentially long) initial import are covered by the next
      // history sync rather than falling into a silent gap.
      const profile = await gmail.users.getProfile({ userId: "me" });

      if (existingPersonalMail === 0) {
        const messageIds = await listAllMessageIds(
          gmail,
          buildAllowlistQuery(allowlistEmails),
        );
        const initialResult = await syncMessageIds(
          gmail,
          messageIds,
          syncRunId,
          "personal_backfill",
        );
        messagesAdded += initialResult.added;
        messagesSkipped += initialResult.skipped;
        errors.push(...initialResult.errors);
      }

      if (profile.data.historyId) {
        await saveHistoryId("personal_backfill", profile.data.historyId);
      }
    } else {
      try {
        const historyResult = await syncViaHistory(
          gmail,
          connection.lastHistoryId,
          syncRunId,
          "personal_backfill",
          { allowlistEmails },
        );
        messagesAdded += historyResult.added;
        messagesSkipped += historyResult.skipped;
        errors.push(...historyResult.errors);

        if (historyResult.historyId) {
          await saveHistoryId("personal_backfill", historyResult.historyId);
        }
      } catch (historyError) {
        if (!isExpiredHistoryError(historyError)) {
          throw historyError;
        }

        const profile = await gmail.users.getProfile({ userId: "me" });
        if (profile.data.historyId) {
          await saveHistoryId("personal_backfill", profile.data.historyId);
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    personalSyncInProgress = false;

    try {
      await db
        .update(syncRuns)
        .set({
          finishedAt: new Date().toISOString(),
          messagesAdded,
          messagesSkipped,
          errors: errors.length > 0 ? errors.join("\n") : null,
        })
        .where(eq(syncRuns.id, syncRunId));
    } catch (finalizeError) {
      console.error("[gmail:sync] Could not finalize personal sync run", finalizeError);
    }
  }

  return {
    syncRunId,
    messagesAdded,
    messagesSkipped,
    errors,
  };
}

/** @deprecated Dedicated mailbox sync; use syncPersonalAccount instead. */
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
    const initialImport = (await countEmailsBySource("dedicated")) === 0;

    if (initialImport) {
      const profile = await gmail.users.getProfile({ userId: "me" });
      const messageIds = await listAllMessageIds(
        gmail,
        DEDICATED_INITIAL_SYNC_QUERY,
      );
      const initialResult = await syncMessageIds(
        gmail,
        messageIds,
        syncRunId,
        "dedicated",
      );
      messagesAdded += initialResult.added;
      messagesSkipped += initialResult.skipped;
      errors.push(...initialResult.errors);

      if (profile.data.historyId) {
        await saveHistoryId("dedicated", profile.data.historyId);
      }
    } else if (connection.lastHistoryId) {
      try {
        const historyResult = await syncViaHistory(
          gmail,
          connection.lastHistoryId,
          syncRunId,
          "dedicated",
        );
        messagesAdded += historyResult.added;
        messagesSkipped += historyResult.skipped;
        errors.push(...historyResult.errors);

        if (historyResult.historyId) {
          await saveHistoryId("dedicated", historyResult.historyId);
        }
      } catch (historyError) {
        if (!isExpiredHistoryError(historyError)) {
          throw historyError;
        }

        const profile = await gmail.users.getProfile({ userId: "me" });
        if (profile.data.historyId) {
          await saveHistoryId("dedicated", profile.data.historyId);
        }
      }
    } else {
      const profile = await gmail.users.getProfile({ userId: "me" });
      if (profile.data.historyId) {
        await saveHistoryId("dedicated", profile.data.historyId);
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
