import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "@/lib/db";
import {
  emailAttachments,
  emails,
  emailThreads,
} from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";

import type { ParsedEmailMessage } from "./messages";
import { isDuplicateMessage } from "./queries";

export type EmailSource = "personal_backfill" | "dedicated";

type Db = NodePgDatabase<typeof schema>;

export async function storeParsedMessage(input: {
  parsed: ParsedEmailMessage;
  source: EmailSource;
  syncRunId: string;
}): Promise<"added" | "skipped"> {
  const duplicate = await isDuplicateMessage({
    gmailMessageId: input.parsed.gmailMessageId,
    messageIdHeader: input.parsed.messageIdHeader,
  });

  if (duplicate) return "skipped";

  const db = getDb();

  await db.transaction(async (tx) => {
    const threadId = await upsertThread(tx, input.parsed);
    const emailId = randomUUID();

    await tx.insert(emails).values({
      id: emailId,
      threadId,
      gmailMessageId: input.parsed.gmailMessageId,
      messageIdHeader: input.parsed.messageIdHeader,
      inReplyTo: input.parsed.inReplyTo,
      referencesHeader: input.parsed.referencesHeader,
      fromAddress: input.parsed.fromAddress,
      toAddresses: JSON.stringify(input.parsed.toAddresses),
      ccAddresses: JSON.stringify(input.parsed.ccAddresses),
      subject: input.parsed.subject,
      bodyText: input.parsed.bodyText,
      bodyHtml: input.parsed.bodyHtml,
      receivedAt: input.parsed.receivedAt,
      source: input.source,
      syncRunId: input.syncRunId,
      processedAt: null,
    });

    if (input.parsed.attachments.length > 0) {
      await tx.insert(emailAttachments).values(
        input.parsed.attachments.map((attachment) => ({
          id: randomUUID(),
          emailId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          gmailAttachmentId: attachment.gmailAttachmentId,
        })),
      );
    }
  });

  return "added";
}

async function upsertThread(tx: Db, parsed: ParsedEmailMessage): Promise<string> {
  const [existing] = await tx
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.gmailThreadId, parsed.gmailThreadId))
    .limit(1);

  if (existing) {
    if (parsed.receivedAt > existing.lastMessageAt) {
      await tx
        .update(emailThreads)
        .set({
          subject: parsed.subject,
          lastMessageAt: parsed.receivedAt,
        })
        .where(eq(emailThreads.id, existing.id));
    }
    return existing.id;
  }

  const id = randomUUID();
  await tx.insert(emailThreads).values({
    id,
    gmailThreadId: parsed.gmailThreadId,
    subject: parsed.subject,
    lastMessageAt: parsed.receivedAt,
  });
  return id;
}
