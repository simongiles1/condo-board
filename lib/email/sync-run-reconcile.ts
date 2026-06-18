import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";

export const SYNC_RUN_INTERRUPTED_MESSAGE =
  "Sync interrupted (app restarted or request timed out).";

const DEFAULT_STALE_SYNC_RUN_MS = 2 * 60 * 60 * 1000;

export async function reconcileStaleSyncRuns(options?: {
  closeAllUnfinished?: boolean;
  maxAgeMs?: number;
}): Promise<number> {
  const db = getDb();
  const unfinished = await db
    .select({
      id: syncRuns.id,
      startedAt: syncRuns.startedAt,
      errors: syncRuns.errors,
    })
    .from(syncRuns)
    .where(
      and(
        isNull(syncRuns.finishedAt),
        inArray(syncRuns.trigger, ["cron", "manual"]),
      ),
    );

  const now = Date.now();
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_STALE_SYNC_RUN_MS;
  const toClose = unfinished.filter((run) =>
    options?.closeAllUnfinished
      ? true
      : now - Date.parse(run.startedAt) >= maxAgeMs,
  );

  if (toClose.length === 0) return 0;

  const finishedAt = new Date().toISOString();
  await Promise.all(
    toClose.map((run) =>
      db
        .update(syncRuns)
        .set({
          finishedAt,
          errors: run.errors ?? SYNC_RUN_INTERRUPTED_MESSAGE,
        })
        .where(eq(syncRuns.id, run.id)),
    ),
  );

  return toClose.length;
}
