import { rm } from "fs/promises";
import path from "path";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  analysisQueue,
  budgetCategories,
  budgetLineItems,
  calendarEvents,
  capitalProjects,
  contracts,
  discoveredFacts,
  emailAttachments,
  emails,
  entityMentions,
  equipmentAssets,
  extractedActionItems,
  extractionSkillAuditLog,
  extractionSkillEntries,
  extractionSkillVersions,
  extractionSources,
  globalTodos,
  invoices,
  maintenanceEvents,
  meetings,
  residentIssues,
  vendors,
} from "@/lib/db/schema";

export type PurgeProcessedDataResult = {
  deletedMeetings: number;
  deletedGlobalTodos: number;
  deletedExtractionSources: number;
  deletedDiscoveredFacts: number;
  deletedAnalysisQueue: number;
  resetEmails: number;
  resetAttachments: number;
};

/**
 * Removes all AI-derived data (meetings, extractions, insights, queue) while
 * keeping imported emails, threads, attachments, sync history, and Gmail
 * connections intact.
 */
export async function purgeProcessedData(): Promise<PurgeProcessedDataResult> {
  const db = getDb();

  const meetingRows = db.select({ id: meetings.id }).from(meetings).all();
  const meetingIds = meetingRows.map((row) => row.id);

  // better-sqlite3 transactions must be synchronous (no async callback).
  const result = db.transaction((tx) => {
    for (const table of [
      calendarEvents,
      maintenanceEvents,
      budgetLineItems,
      invoices,
      contracts,
      residentIssues,
      capitalProjects,
      entityMentions,
      extractedActionItems,
    ] as const) {
      tx.delete(table).where(sql`1 = 1`).run();
    }

    const deletedDiscoveredFacts = tx
      .delete(discoveredFacts)
      .where(sql`1 = 1`)
      .returning({ id: discoveredFacts.id })
      .all().length;

    const deletedExtractionSources = tx
      .delete(extractionSources)
      .where(sql`1 = 1`)
      .returning({ id: extractionSources.id })
      .all().length;

    tx.delete(extractionSkillAuditLog).where(sql`1 = 1`).run();
    tx.delete(extractionSkillEntries).where(sql`1 = 1`).run();
    tx.delete(extractionSkillVersions).where(sql`1 = 1`).run();

    const deletedGlobalTodos = tx
      .delete(globalTodos)
      .where(sql`1 = 1`)
      .returning({ id: globalTodos.id })
      .all().length;

    const deletedMeetings = tx
      .delete(meetings)
      .where(sql`1 = 1`)
      .returning({ id: meetings.id })
      .all().length;

    for (const table of [equipmentAssets, vendors, budgetCategories] as const) {
      tx.delete(table).where(sql`1 = 1`).run();
    }

    const deletedAnalysisQueue = tx
      .delete(analysisQueue)
      .where(sql`1 = 1`)
      .returning({ id: analysisQueue.id })
      .all().length;

    const resetEmails = tx
      .update(emails)
      .set({ processedAt: null })
      .where(sql`${emails.processedAt} IS NOT NULL`)
      .returning({ id: emails.id })
      .all().length;

    const resetAttachments = tx
      .update(emailAttachments)
      .set({
        processedAt: null,
        contentHash: null,
        cachedFilePath: null,
      })
      .where(
        sql`${emailAttachments.processedAt} IS NOT NULL OR ${emailAttachments.contentHash} IS NOT NULL OR ${emailAttachments.cachedFilePath} IS NOT NULL`,
      )
      .returning({ id: emailAttachments.id })
      .all().length;

    return {
      deletedMeetings,
      deletedGlobalTodos,
      deletedExtractionSources,
      deletedDiscoveredFacts,
      deletedAnalysisQueue,
      resetEmails,
      resetAttachments,
    };
  });

  const uploadRoot = path.join(process.cwd(), "uploads");
  for (const id of meetingIds) {
    try {
      await rm(path.join(uploadRoot, id), { recursive: true, force: true });
    } catch (error) {
      console.warn("[purge-processed-data] meeting upload cleanup", id, error);
    }
  }

  return result;
}
