import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailThreads, emails, gmailConnections, syncRuns } from "@/lib/db/schema";

export type PurgeResult = {
  deletedEmails: number;
  deletedThreads: number;
  deletedSyncRuns: number;
  deletedConnections: number;
};

/** Remove all imported email data and Gmail OAuth connections. */
export async function purgeImportedEmails(): Promise<PurgeResult> {
  const db = getDb();

  const deletedEmails = (
    await db.delete(emails).where(sql`1 = 1`).returning({ id: emails.id })
  ).length;

  const deletedThreads = (
    await db
      .delete(emailThreads)
      .where(sql`1 = 1`)
      .returning({ id: emailThreads.id })
  ).length;

  const deletedSyncRuns = (
    await db.delete(syncRuns).where(sql`1 = 1`).returning({ id: syncRuns.id })
  ).length;

  const deletedConnections = (
    await db
      .delete(gmailConnections)
      .where(sql`1 = 1`)
      .returning({ id: gmailConnections.id })
  ).length;

  return {
    deletedEmails,
    deletedThreads,
    deletedSyncRuns,
    deletedConnections,
  };
}
