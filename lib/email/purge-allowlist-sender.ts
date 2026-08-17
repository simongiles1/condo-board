/**
 * Delete imported mail that exists only because a mistaken allowlist sender
 * was saved. App database only — Gmail is unchanged.
 */

import { and, eq, inArray, or } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  analysisQueue,
  emailAttachments,
  emailSyncExclusions,
  emailThreads,
  emails,
  extractedActionItems,
  extractionSources,
  senderAllowlist,
} from "@/lib/db/schema";
import { getAllowlistEmails } from "@/lib/gmail/queries";

import {
  classifySenderImport,
  normalizeAllowlistMailbox,
} from "./purge-allowlist-sender-classify";

export type PurgeAllowlistSenderPreview = {
  email: string;
  onAllowlist: boolean;
  exclusiveThreadCount: number;
  exclusiveEmailCount: number;
  mixedThreadCount: number;
};

export type PurgeAllowlistSenderResult = PurgeAllowlistSenderPreview & {
  deletedEmails: number;
  deletedThreads: number;
  deletedExtractionSources: number;
  deletedAnalysisQueue: number;
  deletedActionItems: number;
  recordedExclusions: number;
  removedFromAllowlist: boolean;
};

async function loadClassification(targetEmail: string) {
  const target = normalizeAllowlistMailbox(targetEmail);
  if (!target) {
    throw new Error("Enter a valid email address.");
  }

  const db = getDb();
  const allowlist = await getAllowlistEmails();
  const onAllowlist = allowlist.includes(target);
  const otherAllowlistEmails = allowlist.filter((email) => email !== target);

  const messages = await db
    .select({
      id: emails.id,
      threadId: emails.threadId,
      fromAddress: emails.fromAddress,
      toAddresses: emails.toAddresses,
      ccAddresses: emails.ccAddresses,
      gmailMessageId: emails.gmailMessageId,
      messageIdHeader: emails.messageIdHeader,
    })
    .from(emails);

  const classified = classifySenderImport({
    targetEmail: target,
    otherAllowlistEmails,
    messages,
  });

  return { target, onAllowlist, classified, messages };
}

export async function previewPurgeAllowlistSender(
  email: string,
): Promise<PurgeAllowlistSenderPreview> {
  const { target, onAllowlist, classified } = await loadClassification(email);
  return {
    email: target,
    onAllowlist,
    exclusiveThreadCount: classified.exclusiveThreadIds.length,
    exclusiveEmailCount: classified.exclusiveEmailIds.length,
    mixedThreadCount: classified.mixedThreadIds.length,
  };
}

export async function purgeAllowlistSenderImported(input: {
  email: string;
  removeFromAllowlist?: boolean;
}): Promise<PurgeAllowlistSenderResult> {
  const { target, onAllowlist, classified, messages } = await loadClassification(
    input.email,
  );
  const removeFromAllowlist = Boolean(input.removeFromAllowlist) && onAllowlist;
  const emailIds = classified.exclusiveEmailIds;
  const emailIdSet = new Set(emailIds);
  const threadIds = classified.exclusiveThreadIds;

  if (emailIds.length === 0 && threadIds.length === 0 && !removeFromAllowlist) {
    return {
      email: target,
      onAllowlist,
      exclusiveThreadCount: 0,
      exclusiveEmailCount: 0,
      mixedThreadCount: classified.mixedThreadIds.length,
      deletedEmails: 0,
      deletedThreads: 0,
      deletedExtractionSources: 0,
      deletedAnalysisQueue: 0,
      deletedActionItems: 0,
      recordedExclusions: 0,
      removedFromAllowlist: false,
    };
  }

  const db = getDb();
  const exclusionRows = messages
    .filter((message) => emailIdSet.has(message.id))
    .map((message) => ({
      gmailMessageId: message.gmailMessageId,
      messageIdHeader: message.messageIdHeader,
      excludedAt: new Date().toISOString(),
    }));

  const result = await db.transaction(async (tx) => {
    let deletedActionItems = 0;
    let deletedAnalysisQueue = 0;
    let deletedExtractionSources = 0;
    let deletedEmails = 0;
    let deletedThreads = 0;
    let recordedExclusions = 0;
    let removedFromAllowlist = false;

    const attachmentIds =
      emailIds.length === 0
        ? []
        : (
            await tx
              .select({ id: emailAttachments.id })
              .from(emailAttachments)
              .where(inArray(emailAttachments.emailId, emailIds))
          ).map((row) => row.id);

    if (threadIds.length > 0) {
      deletedActionItems = (
        await tx
          .delete(extractedActionItems)
          .where(inArray(extractedActionItems.emailThreadId, threadIds))
          .returning({ id: extractedActionItems.id })
      ).length;
    }

    const queueIds = [...emailIds, ...threadIds, ...attachmentIds];
    if (queueIds.length > 0) {
      deletedAnalysisQueue = (
        await tx
          .delete(analysisQueue)
          .where(inArray(analysisQueue.unitId, queueIds))
          .returning({ id: analysisQueue.id })
      ).length;
    }

    const sourceFilters = [];
    if (threadIds.length > 0) {
      sourceFilters.push(inArray(extractionSources.emailThreadId, threadIds));
    }
    if (emailIds.length > 0) {
      sourceFilters.push(
        and(
          eq(extractionSources.sourceType, "email_message"),
          inArray(extractionSources.sourceId, emailIds),
        ),
      );
    }
    if (attachmentIds.length > 0) {
      sourceFilters.push(
        and(
          eq(extractionSources.sourceType, "email_attachment"),
          inArray(extractionSources.sourceId, attachmentIds),
        ),
      );
    }
    if (sourceFilters.length > 0) {
      deletedExtractionSources = (
        await tx
          .delete(extractionSources)
          .where(or(...sourceFilters))
          .returning({ id: extractionSources.id })
      ).length;
    }

    if (exclusionRows.length > 0) {
      const inserted = await tx
        .insert(emailSyncExclusions)
        .values(exclusionRows)
        .onConflictDoNothing()
        .returning({ gmailMessageId: emailSyncExclusions.gmailMessageId });
      recordedExclusions = inserted.length;
    }

    if (emailIds.length > 0) {
      deletedEmails = (
        await tx
          .delete(emails)
          .where(inArray(emails.id, emailIds))
          .returning({ id: emails.id })
      ).length;
    }

    if (threadIds.length > 0) {
      deletedThreads = (
        await tx
          .delete(emailThreads)
          .where(inArray(emailThreads.id, threadIds))
          .returning({ id: emailThreads.id })
      ).length;
    }

    if (removeFromAllowlist) {
      const removed = await tx
        .delete(senderAllowlist)
        .where(eq(senderAllowlist.email, target))
        .returning({ id: senderAllowlist.id });
      removedFromAllowlist = removed.length > 0;
    }

    return {
      deletedActionItems,
      deletedAnalysisQueue,
      deletedExtractionSources,
      deletedEmails,
      deletedThreads,
      recordedExclusions,
      removedFromAllowlist,
    };
  });

  return {
    email: target,
    onAllowlist,
    exclusiveThreadCount: classified.exclusiveThreadIds.length,
    exclusiveEmailCount: classified.exclusiveEmailIds.length,
    mixedThreadCount: classified.mixedThreadIds.length,
    ...result,
  };
}
