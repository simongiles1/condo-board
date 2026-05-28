import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailAttachments, emails } from "@/lib/db/schema";

import {
  categorizeFiles,
  type CategorizedFile,
  type CategorizedFiles,
} from "./file-categories";

export async function loadCategorizedFiles(): Promise<CategorizedFiles> {
  const db = getDb();

  const rows = await db
    .select({
      id: emailAttachments.id,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      sizeBytes: emailAttachments.sizeBytes,
      emailId: emails.id,
      threadId: emails.threadId,
      fromAddress: emails.fromAddress,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
    })
    .from(emailAttachments)
    .innerJoin(emails, eq(emailAttachments.emailId, emails.id))
    .orderBy(desc(emails.receivedAt));

  return categorizeFiles(rows as CategorizedFile[]);
}
