import { desc, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  emailAttachments,
  emails,
  extractionSources,
} from "@/lib/db/schema";

export type BuildingEmailReference = {
  emailId: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  threadId: string | null;
};

/**
 * Resolves extraction source IDs to the email that produced the extraction.
 * Handles email_message, email_attachment, and email_thread source types.
 */
export async function resolveExtractionSourceEmails(
  sourceIds: string[],
): Promise<Map<string, BuildingEmailReference>> {
  const uniqueIds = [...new Set(sourceIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const db = getDb();
  const sources = await db
    .select()
    .from(extractionSources)
    .where(inArray(extractionSources.id, uniqueIds));

  if (!sources.length) return new Map();

  const attachmentIds = sources
    .filter((source) => source.sourceType === "email_attachment")
    .map((source) => source.sourceId);

  const attachmentEmailById = new Map<string, string>();
  if (attachmentIds.length) {
    const attachments = await db
      .select({
        id: emailAttachments.id,
        emailId: emailAttachments.emailId,
      })
      .from(emailAttachments)
      .where(inArray(emailAttachments.id, attachmentIds));

    for (const attachment of attachments) {
      attachmentEmailById.set(attachment.id, attachment.emailId);
    }
  }

  const threadIds = sources
    .filter((source) => source.sourceType === "email_thread")
    .map((source) => source.sourceId);

  const threadEmailById = new Map<string, string>();
  if (threadIds.length) {
    const threadMessages = await db
      .select({
        id: emails.id,
        threadId: emails.threadId,
        receivedAt: emails.receivedAt,
      })
      .from(emails)
      .where(inArray(emails.threadId, threadIds))
      .orderBy(desc(emails.receivedAt));

    for (const message of threadMessages) {
      if (!message.threadId || threadEmailById.has(message.threadId)) continue;
      threadEmailById.set(message.threadId, message.id);
    }
  }

  const sourceToEmailId = new Map<string, string>();
  for (const source of sources) {
    let emailId: string | null = null;

    if (source.sourceType === "email_message") {
      emailId = source.sourceId;
    } else if (source.sourceType === "email_attachment") {
      emailId = attachmentEmailById.get(source.sourceId) ?? null;
    } else if (source.sourceType === "email_thread") {
      emailId = threadEmailById.get(source.sourceId) ?? null;
    }

    if (emailId) {
      sourceToEmailId.set(source.id, emailId);
    }
  }

  const emailIds = [...new Set(sourceToEmailId.values())];
  if (!emailIds.length) return new Map();

  const emailRows = await db
    .select({
      id: emails.id,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      threadId: emails.threadId,
    })
    .from(emails)
    .where(inArray(emails.id, emailIds));

  const emailById = new Map(
    emailRows.map((email) => [
      email.id,
      {
        emailId: email.id,
        subject: email.subject,
        fromAddress: email.fromAddress,
        receivedAt: email.receivedAt,
        threadId: email.threadId,
      } satisfies BuildingEmailReference,
    ]),
  );

  const resolved = new Map<string, BuildingEmailReference>();
  for (const [sourceId, emailId] of sourceToEmailId) {
    const email = emailById.get(emailId);
    if (email) {
      resolved.set(sourceId, email);
    }
  }

  return resolved;
}

export function dedupeEmailReferences(
  references: BuildingEmailReference[],
): BuildingEmailReference[] {
  const seen = new Set<string>();
  const result: BuildingEmailReference[] = [];

  for (const reference of references) {
    if (seen.has(reference.emailId)) continue;
    seen.add(reference.emailId);
    result.push(reference);
  }

  return result.sort(
    (a, b) =>
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
}
