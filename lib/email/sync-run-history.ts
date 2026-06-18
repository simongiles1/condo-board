import { desc, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";

export type SyncHistoryRun = {
  id: string;
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt: string | null;
  messagesAdded: number;
  messagesSkipped: number;
  errors: string | null;
};

import { reconcileStaleSyncRuns } from "@/lib/email/sync-run-reconcile";

export async function getSyncRunHistory(limit = 60): Promise<SyncHistoryRun[]> {
  await reconcileStaleSyncRuns();

  const db = getDb();
  const rows = await db
    .select({
      id: syncRuns.id,
      trigger: syncRuns.trigger,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
      messagesAdded: syncRuns.messagesAdded,
      messagesSkipped: syncRuns.messagesSkipped,
      errors: syncRuns.errors,
    })
    .from(syncRuns)
    .where(inArray(syncRuns.trigger, ["cron", "manual"]))
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    trigger: row.trigger as SyncHistoryRun["trigger"],
  }));
}
