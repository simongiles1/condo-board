import { and, count, eq, inArray, or } from "drizzle-orm";

import {
  emptyThreadProcessedDataCounts,
  extractionFieldsToStrip,
  shouldPurgeThreadExtractionArchive,
  THREAD_PROCESSED_DATA_CATEGORIES,
  type ThreadProcessedDataCategory,
  type ThreadProcessedDataCounts,
} from "@/lib/analysis/thread-processed-data-categories";
import { getDb } from "@/lib/db";
import {
  analysisQueue,
  budgetLineItems,
  calendarEvents,
  capitalProjects,
  contactEmails,
  contracts,
  discoveredFacts,
  emailAttachments,
  emails,
  entityMentions,
  equipmentAssets,
  extractedActionItems,
  extractionSources,
  invoices,
  maintenanceEvents,
  residentIssues,
} from "@/lib/db/schema";
import { fetchExtractionAuditForThread } from "@/lib/email/extraction-audit";

export type ThreadProcessedDataSummary = {
  counts: ThreadProcessedDataCounts;
  categoriesWithData: ThreadProcessedDataCategory[];
};

export type PurgeThreadProcessedDataResult = {
  counts: ThreadProcessedDataCounts;
  purgedExtractionArchive: boolean;
  updatedExtractionSources: number;
  resetEmails: number;
  resetAttachments: number;
  deletedExtractionSources: number;
  deletedAnalysisQueue: number;
};

async function stripThreadExtractionArchiveFields(
  threadId: string,
  categories: ThreadProcessedDataCategory[],
): Promise<number> {
  const fieldsToStrip = extractionFieldsToStrip(categories);
  if (fieldsToStrip.length === 0) return 0;

  const db = getDb();
  const sources = await db
    .select({
      id: extractionSources.id,
      rawExtractionJson: extractionSources.rawExtractionJson,
    })
    .from(extractionSources)
    .where(eq(extractionSources.emailThreadId, threadId));

  let updated = 0;
  for (const source of sources) {
    let raw: unknown;
    try {
      raw = JSON.parse(source.rawExtractionJson);
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;

    const document = raw as Record<string, unknown>;
    let changed = false;

    for (const field of fieldsToStrip) {
      if (field in document) {
        delete document[field];
        changed = true;
      }
    }

    if (!changed) continue;

    await db
      .update(extractionSources)
      .set({ rawExtractionJson: JSON.stringify(document) })
      .where(eq(extractionSources.id, source.id));
    updated += 1;
  }

  return updated;
}

async function getThreadExtractionSourceIds(threadId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: extractionSources.id })
    .from(extractionSources)
    .where(eq(extractionSources.emailThreadId, threadId));
  return rows.map((row) => row.id);
}

async function getThreadEmailIds(threadId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.threadId, threadId));
  return rows.map((row) => row.id);
}

export async function getThreadProcessedDataSummary(
  threadId: string,
): Promise<ThreadProcessedDataSummary> {
  const counts = emptyThreadProcessedDataCounts();
  const audit = await fetchExtractionAuditForThread(threadId);

  for (const record of audit.records) {
    for (const group of record.destinationGroups) {
      const category = group.destination.id;
      if (!(category in counts)) continue;
      counts[category as ThreadProcessedDataCategory] += group.items.length;
    }
  }

  if (audit.threadEntityGroups.length > 0) {
    counts.entities = audit.threadEntityGroups.length;
  }

  if (audit.reconciledMaintenanceItems.length > counts.maintenance) {
    counts.maintenance = audit.reconciledMaintenanceItems.length;
  }

  const categoriesWithData = THREAD_PROCESSED_DATA_CATEGORIES.filter(
    (category) => counts[category] > 0,
  );

  return { counts, categoriesWithData };
}

/** @deprecated Use getThreadProcessedDataSummary instead. */
export async function getThreadProcessedDataCounts(
  threadId: string,
): Promise<ThreadProcessedDataCounts> {
  const summary = await getThreadProcessedDataSummary(threadId);
  return summary.counts;
}

async function deleteMaintenanceDataForSources(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  sourceIds: string[],
): Promise<number> {
  if (sourceIds.length === 0) return 0;

  const linkedEquipment = await tx
    .select({ equipmentId: maintenanceEvents.equipmentId })
    .from(maintenanceEvents)
    .where(inArray(maintenanceEvents.sourceId, sourceIds));

  const equipmentIds = [
    ...new Set(
      linkedEquipment
        .map((row) => row.equipmentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const maintenance = await tx
    .delete(maintenanceEvents)
    .where(inArray(maintenanceEvents.sourceId, sourceIds))
    .returning({ id: maintenanceEvents.id });

  await tx
    .delete(calendarEvents)
    .where(
      and(
        inArray(calendarEvents.sourceId, sourceIds),
        eq(calendarEvents.eventType, "maintenance"),
      ),
    );

  for (const equipmentId of equipmentIds) {
    const [{ remaining }] = await tx
      .select({ remaining: count() })
      .from(maintenanceEvents)
      .where(eq(maintenanceEvents.equipmentId, equipmentId));

    if (remaining === 0) {
      await tx
        .delete(equipmentAssets)
        .where(eq(equipmentAssets.id, equipmentId));
    }
  }

  return maintenance.length;
}

export async function purgeThreadProcessedData(input: {
  threadId: string;
  categories: ThreadProcessedDataCategory[];
  categoriesWithData?: ThreadProcessedDataCategory[];
}): Promise<PurgeThreadProcessedDataResult> {
  const categories = [...new Set(input.categories)];
  if (categories.length === 0) {
    throw new Error("Select at least one extraction category to delete.");
  }

  const summary =
    input.categoriesWithData ??
    (await getThreadProcessedDataSummary(input.threadId)).categoriesWithData;
  const sourceIds = await getThreadExtractionSourceIds(input.threadId);
  const purgeArchive = shouldPurgeThreadExtractionArchive(
    categories,
    summary,
  );

  const deletedCounts = emptyThreadProcessedDataCounts();
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    if (sourceIds.length > 0) {
      if (categories.includes("calendar")) {
        const calendarRows = await tx
          .delete(calendarEvents)
          .where(
            and(
              inArray(calendarEvents.sourceId, sourceIds),
              inArray(calendarEvents.eventType, ["meeting", "deadline"]),
            ),
          )
          .returning({ id: calendarEvents.id });
        deletedCounts.calendar = calendarRows.length;
      }

      if (categories.includes("maintenance")) {
        deletedCounts.maintenance = await deleteMaintenanceDataForSources(
          tx,
          sourceIds,
        );
      }

      if (categories.includes("financial")) {
        const budgetRows = await tx
          .delete(budgetLineItems)
          .where(inArray(budgetLineItems.sourceId, sourceIds))
          .returning({ id: budgetLineItems.id });
        const invoiceRows = await tx
          .delete(invoices)
          .where(inArray(invoices.sourceId, sourceIds))
          .returning({ id: invoices.id });
        deletedCounts.financial = budgetRows.length + invoiceRows.length;
      }

      if (categories.includes("vendors")) {
        const contractRows = await tx
          .delete(contracts)
          .where(inArray(contracts.sourceId, sourceIds))
          .returning({ id: contracts.id });
        deletedCounts.vendors = contractRows.length;
      }

      if (categories.includes("capital")) {
        const capitalRows = await tx
          .delete(capitalProjects)
          .where(inArray(capitalProjects.sourceId, sourceIds))
          .returning({ id: capitalProjects.id });
        deletedCounts.capital = capitalRows.length;
      }

      if (categories.includes("resident")) {
        const residentRows = await tx
          .delete(residentIssues)
          .where(inArray(residentIssues.sourceId, sourceIds))
          .returning({ id: residentIssues.id });
        deletedCounts.resident = residentRows.length;
      }

      if (categories.includes("entities")) {
        const entityRows = await tx
          .delete(entityMentions)
          .where(inArray(entityMentions.sourceId, sourceIds))
          .returning({ id: entityMentions.id });
        const contactEmailRows = await tx
          .delete(contactEmails)
          .where(inArray(contactEmails.sourceId, sourceIds))
          .returning({ id: contactEmails.id });
        deletedCounts.entities = entityRows.length + contactEmailRows.length;
      }

      if (categories.includes("skill")) {
        const skillRows = await tx
          .delete(discoveredFacts)
          .where(inArray(discoveredFacts.sourceId, sourceIds))
          .returning({ id: discoveredFacts.id });
        deletedCounts.skill = skillRows.length;
      }
    }

    if (categories.includes("action_items")) {
      const actionItems = await tx
        .delete(extractedActionItems)
        .where(
          sourceIds.length > 0
            ? or(
                eq(extractedActionItems.emailThreadId, input.threadId),
                inArray(extractedActionItems.sourceId, sourceIds),
              )
            : eq(extractedActionItems.emailThreadId, input.threadId),
        )
        .returning({ id: extractedActionItems.id });
      deletedCounts.action_items = actionItems.length;
    }

    let deletedExtractionSources = 0;
    let deletedAnalysisQueue = 0;
    let resetEmails = 0;
    let resetAttachments = 0;

    if (purgeArchive && sourceIds.length > 0) {
      deletedExtractionSources = (
        await tx
          .delete(extractionSources)
          .where(eq(extractionSources.emailThreadId, input.threadId))
          .returning({ id: extractionSources.id })
      ).length;

      const emailIds = await getThreadEmailIds(input.threadId);
      if (emailIds.length > 0) {
        const attachmentRows = await tx
          .select({ id: emailAttachments.id })
          .from(emailAttachments)
          .where(inArray(emailAttachments.emailId, emailIds));
        const attachmentIds = attachmentRows.map((row) => row.id);

        const queueConditions = [
          and(
            eq(analysisQueue.unitType, "email_thread"),
            eq(analysisQueue.unitId, input.threadId),
          ),
          and(
            eq(analysisQueue.unitType, "email_message"),
            inArray(analysisQueue.unitId, emailIds),
          ),
        ];
        if (attachmentIds.length > 0) {
          queueConditions.push(
            and(
              eq(analysisQueue.unitType, "email_attachment"),
              inArray(analysisQueue.unitId, attachmentIds),
            ),
          );
        }

        deletedAnalysisQueue = (
          await tx
            .delete(analysisQueue)
            .where(or(...queueConditions))
            .returning({ id: analysisQueue.id })
        ).length;

        resetEmails = (
          await tx
            .update(emails)
            .set({ processedAt: null })
            .where(inArray(emails.id, emailIds))
            .returning({ id: emails.id })
        ).length;

        resetAttachments = (
          await tx
            .update(emailAttachments)
            .set({
              processedAt: null,
              contentHash: null,
              cachedFilePath: null,
            })
            .where(inArray(emailAttachments.emailId, emailIds))
            .returning({ id: emailAttachments.id })
        ).length;
      }
    }

    return {
      counts: deletedCounts,
      purgedExtractionArchive: purgeArchive && deletedExtractionSources > 0,
      resetEmails,
      resetAttachments,
      deletedExtractionSources,
      deletedAnalysisQueue,
    };
  });

  const updatedExtractionSources =
    !purgeArchive && sourceIds.length > 0
      ? await stripThreadExtractionArchiveFields(input.threadId, categories)
      : 0;

  return {
    ...result,
    updatedExtractionSources,
  };
}
