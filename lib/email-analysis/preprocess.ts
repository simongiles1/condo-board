import { asc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emailAttachments,
  emails,
  emailThreads,
  extractionSources,
} from "@/lib/db/schema";
import { computeThreadUniqueBodies } from "@/lib/email/thread-unique-content";

export async function preprocessEmailMessage(emailId: string): Promise<string> {
  const db = getDb();
  const [email] = await db.select().from(emails).where(eq(emails.id, emailId));
  if (!email) throw new Error("Email not found.");

  const threadMessages = email.threadId
    ? await db
        .select()
        .from(emails)
        .where(eq(emails.threadId, email.threadId))
        .orderBy(asc(emails.receivedAt))
    : [email];

  const uniqueMap = computeThreadUniqueBodies(
    threadMessages.map((m) => ({
      id: m.id,
      bodyText: m.bodyText,
      bodyHtml: m.bodyHtml,
      receivedAt: m.receivedAt,
    })),
  );

  for (const message of threadMessages) {
    const unique = uniqueMap.get(message.id) ?? message.bodyText;
    await db
      .update(emails)
      .set({ bodyTextUnique: unique })
      .where(eq(emails.id, message.id));
  }

  return uniqueMap.get(emailId) ?? email.bodyText;
}

export async function getThreadContext(threadId: string | null) {
  if (!threadId) return null;
  const db = getDb();
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId));
  return thread;
}

export async function getEmailAttachments(emailId: string) {
  const db = getDb();
  return db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.emailId, emailId));
}

export async function findExistingAttachmentExtraction(contentHash: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(extractionSources)
    .where(
      sql`${extractionSources.sourceType} = 'email_attachment' AND ${extractionSources.contentHash} = ${contentHash}`,
    )
    .limit(1);
  return row ?? null;
}

export async function countUnprocessedEmails(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(emails)
    .where(isNull(emails.processedAt));
  return row?.count ?? 0;
}

export async function countProcessedEmails(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(emails)
    .where(sql`${emails.processedAt} IS NOT NULL`);
  return row?.count ?? 0;
}

export async function getLatestThreadExtraction(threadId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(extractionSources)
    .where(eq(extractionSources.emailThreadId, threadId))
    .orderBy(sql`${extractionSources.processedAt} DESC`)
    .limit(1);
  return row ?? null;
}
