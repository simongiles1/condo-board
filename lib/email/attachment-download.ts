import { and, count, isNotNull, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailAttachments } from "@/lib/db/schema";
import { downloadEmailAttachment } from "@/lib/gmail/attachments";

export const ATTACHMENT_DOWNLOAD_BATCH_SIZE = 8;

export type AttachmentDownloadBatchResult = {
  downloaded: number;
  failed: number;
  total: number;
  cached: number;
  remaining: number;
  lastError: string | null;
};

export async function getAttachmentDownloadStatus(): Promise<{
  total: number;
  cached: number;
  remaining: number;
}> {
  const db = getDb();
  const [row] = await db
    .select({
      total: count(),
      cached: count(emailAttachments.contentHash),
    })
    .from(emailAttachments)
    .where(isNotNull(emailAttachments.gmailAttachmentId));

  const total = row?.total ?? 0;
  const cached = row?.cached ?? 0;

  return {
    total,
    cached,
    remaining: total - cached,
  };
}

export async function downloadUncachedAttachmentBatch(
  batchSize = ATTACHMENT_DOWNLOAD_BATCH_SIZE,
): Promise<AttachmentDownloadBatchResult> {
  const db = getDb();
  const pending = await db
    .select({
      id: emailAttachments.id,
      emailId: emailAttachments.emailId,
    })
    .from(emailAttachments)
    .where(
      and(
        isNull(emailAttachments.contentHash),
        isNotNull(emailAttachments.gmailAttachmentId),
      ),
    )
    .limit(batchSize);

  let downloaded = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const attachment of pending) {
    try {
      await downloadEmailAttachment({
        attachmentId: attachment.id,
        emailId: attachment.emailId,
      });
      downloaded += 1;
    } catch (error) {
      failed += 1;
      lastError =
        error instanceof Error ? error.message : "Could not download attachment.";
      console.error(
        "[attachment-download]",
        attachment.id,
        lastError,
      );
    }
  }

  const status = await getAttachmentDownloadStatus();

  return {
    downloaded,
    failed,
    ...status,
    lastError,
  };
}
