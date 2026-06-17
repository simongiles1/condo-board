import { rm } from "fs/promises";
import path from "path";

import { eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  analysisQueue,
  emailSyncExclusions,
  emailThreads,
  emails,
  extractedActionItems,
  extractionSources,
  gmailConnections,
  syncRuns,
} from "@/lib/db/schema";

const EMAIL_SOURCE_TYPES = [
  "email_message",
  "email_attachment",
  "email_thread",
] as const;

const EMAIL_QUEUE_TYPES = [
  "email_message",
  "email_thread",
  "email_attachment",
] as const;

export type ClearAllEmailsResult = {
  deletedEmails: number;
  deletedThreads: number;
  deletedSyncRuns: number;
  deletedExclusions: number;
  deletedExtractionSources: number;
  deletedAnalysisQueue: number;
  resetDedicatedSync: boolean;
};

/**
 * Remove all imported email data so personal Gmail can be re-synced from scratch.
 * Keeps Gmail OAuth connections, sender allowlist, and sync schedule.
 */
export async function clearAllEmails(): Promise<ClearAllEmailsResult> {
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    await tx
      .delete(extractedActionItems)
      .where(isNotNull(extractedActionItems.emailThreadId));

    const deletedAnalysisQueue = (
      await tx
        .delete(analysisQueue)
        .where(inArray(analysisQueue.unitType, [...EMAIL_QUEUE_TYPES]))
        .returning({ id: analysisQueue.id })
    ).length;

    const deletedExtractionSources = (
      await tx
        .delete(extractionSources)
        .where(inArray(extractionSources.sourceType, [...EMAIL_SOURCE_TYPES]))
        .returning({ id: extractionSources.id })
    ).length;

    const deletedEmails = (
      await tx.delete(emails).where(sql`1 = 1`).returning({ id: emails.id })
    ).length;

    const deletedThreads = (
      await tx
        .delete(emailThreads)
        .where(sql`1 = 1`)
        .returning({ id: emailThreads.id })
    ).length;

    const deletedExclusions = (
      await tx
        .delete(emailSyncExclusions)
        .where(sql`1 = 1`)
        .returning({ gmailMessageId: emailSyncExclusions.gmailMessageId })
    ).length;

    const deletedSyncRuns = (
      await tx.delete(syncRuns).where(sql`1 = 1`).returning({ id: syncRuns.id })
    ).length;

    const resetRows = await tx
      .update(gmailConnections)
      .set({
        lastHistoryId: null,
        lastSyncAt: null,
      })
      .where(
        inArray(gmailConnections.accountType, ["dedicated", "personal_backfill"]),
      )
      .returning({ id: gmailConnections.id });

    return {
      deletedEmails,
      deletedThreads,
      deletedSyncRuns,
      deletedExclusions,
      deletedExtractionSources,
      deletedAnalysisQueue,
      resetDedicatedSync: resetRows.length > 0,
    };
  });

  const attachmentCacheDir = path.join(
    process.cwd(),
    "data",
    "email-attachments",
  );
  try {
    await rm(attachmentCacheDir, { recursive: true, force: true });
  } catch (error) {
    console.warn("[clear-all-emails] attachment cache cleanup", error);
  }

  return result;
}
