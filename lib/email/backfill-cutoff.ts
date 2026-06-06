import { asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emails } from "@/lib/db/schema";

export type BackfillCutoffInfo = {
  /** ISO timestamp one second before the oldest dedicated-sync message. */
  cutoffAt: string | null;
  /** ISO timestamp of the oldest message imported from the dedicated mailbox. */
  oldestDedicatedReceivedAt: string | null;
};

export async function getOldestDedicatedEmailReceivedAt(): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ receivedAt: emails.receivedAt })
    .from(emails)
    .where(eq(emails.source, "dedicated"))
    .orderBy(asc(emails.receivedAt))
    .limit(1);

  return row?.receivedAt ?? null;
}

/** One second before the oldest dedicated message so backfill cannot overlap sync. */
export function computeBackfillCutoffAt(oldestDedicatedReceivedAt: string): string {
  const oldest = new Date(oldestDedicatedReceivedAt);
  return new Date(oldest.getTime() - 1000).toISOString();
}

export async function getBackfillCutoff(): Promise<BackfillCutoffInfo> {
  const oldestDedicatedReceivedAt = await getOldestDedicatedEmailReceivedAt();
  if (!oldestDedicatedReceivedAt) {
    return { cutoffAt: null, oldestDedicatedReceivedAt: null };
  }

  return {
    cutoffAt: computeBackfillCutoffAt(oldestDedicatedReceivedAt),
    oldestDedicatedReceivedAt,
  };
}
