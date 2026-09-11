import { and, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emails, gmailConnections, syncRuns } from "@/lib/db/schema";

import { resolveCatchupSinceIso } from "./queries";

async function lastCompletedPersonalSyncAt(
  excludeSyncRunId: string | null,
): Promise<string | null> {
  const db = getDb();
  const conditions = [
    eq(syncRuns.accountType, "personal_backfill"),
    isNull(syncRuns.errors),
    isNotNull(syncRuns.finishedAt),
  ];
  if (excludeSyncRunId) {
    conditions.push(ne(syncRuns.id, excludeSyncRunId));
  }

  const [row] = await db
    .select({
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
    })
    .from(syncRuns)
    .where(and(...conditions))
    .orderBy(desc(syncRuns.finishedAt))
    .limit(1);
  return row?.finishedAt ?? row?.startedAt ?? null;
}

async function recentPersonalReceivedAt(): Promise<{
  newestReceivedAt: string | null;
  previousReceivedAt: string | null;
}> {
  const db = getDb();
  const rows = await db
    .select({ receivedAt: emails.receivedAt })
    .from(emails)
    .where(eq(emails.source, "personal_backfill"))
    .orderBy(desc(emails.receivedAt))
    .limit(2);
  return {
    newestReceivedAt: rows[0]?.receivedAt ?? null,
    previousReceivedAt: rows[1]?.receivedAt ?? null,
  };
}

/** Same catch-up origin as `syncPersonalAccount` safety-window search. */
export async function getPersonalCatchupSinceIso(options?: {
  excludeSyncRunId?: string | null;
}): Promise<string | null> {
  const db = getDb();
  const [connection] = await db
    .select({ lastSyncAt: gmailConnections.lastSyncAt })
    .from(gmailConnections)
    .where(eq(gmailConnections.accountType, "personal_backfill"))
    .limit(1);

  const [lastCompletedSyncAt, recent] = await Promise.all([
    lastCompletedPersonalSyncAt(options?.excludeSyncRunId ?? null),
    recentPersonalReceivedAt(),
  ]);

  return resolveCatchupSinceIso({
    lastSyncAt: connection?.lastSyncAt ?? null,
    lastCompletedSyncAt,
    ...recent,
  });
}
