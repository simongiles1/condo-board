import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

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

type Db = BetterSQLite3Database<typeof schema>;

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

  db.transaction((tx) => {
    const threadId = upsertThread(tx, input.parsed);
    const emailId = randomUUID();

    tx.insert(emails)
      .values({
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
      })
      .run();

    if (input.parsed.attachments.length > 0) {
      tx.insert(emailAttachments)
        .values(
          input.parsed.attachments.map((attachment) => ({
            id: randomUUID(),
            emailId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            gmailAttachmentId: attachment.gmailAttachmentId,
          })),
        )
        .run();
    }
  });

  return "added";
}

function upsertThread(tx: Db, parsed: ParsedEmailMessage): string {
  const existing = tx
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.gmailThreadId, parsed.gmailThreadId))
    .get();

  if (existing) {
    if (parsed.receivedAt > existing.lastMessageAt) {
      tx.update(emailThreads)
        .set({
          subject: parsed.subject,
          lastMessageAt: parsed.receivedAt,
        })
        .where(eq(emailThreads.id, existing.id))
        .run();
    }
    return existing.id;
  }

  const id = randomUUID();
  tx.insert(emailThreads)
    .values({
      id,
      gmailThreadId: parsed.gmailThreadId,
      subject: parsed.subject,
      lastMessageAt: parsed.receivedAt,
    })
    .run();
  return id;
}
