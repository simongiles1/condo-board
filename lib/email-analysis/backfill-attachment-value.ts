import { and, eq, isNull, sql } from "drizzle-orm";

import { classifyEmailAttachmentHasValue } from "@/lib/email-analysis/worker";
import { getDb } from "@/lib/db";
import { emailAttachments } from "@/lib/db/schema";

export async function backfillAttachmentValues(input?: {
  limit?: number;
}): Promise<{ processed: number; failed: number }> {
  const db = getDb();
  const limit = input?.limit ?? 10_000;

  const rows = await db
    .select({
      id: emailAttachments.id,
      emailId: emailAttachments.emailId,
    })
    .from(emailAttachments)
    .where(
      and(
        isNull(emailAttachments.hasValue),
        sql`${emailAttachments.gmailAttachmentId} IS NOT NULL`,
      ),
    )
    .limit(limit);

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await classifyEmailAttachmentHasValue({
        attachmentId: row.id,
        emailId: row.emailId,
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error("[backfill-attachment-value]", {
        attachmentId: row.id,
        emailId: row.emailId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return { processed, failed };
}
