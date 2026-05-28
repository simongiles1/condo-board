import { count, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emails, emailSyncExclusions, emailThreads } from "@/lib/db/schema";
import { trashDedicatedGmailMessage } from "@/lib/gmail/delete";

export type DeleteEmailOptions = {
  deleteFromDb: boolean;
  deleteFromGmail: boolean;
};

export type DeleteEmailResult = {
  deletedFromDb: boolean;
  deletedFromGmail: boolean;
  threadDeleted: boolean;
  threadId: string | null;
  errors: string[];
};

async function removeEmailFromDb(email: typeof emails.$inferSelect): Promise<{
  threadDeleted: boolean;
  threadId: string | null;
}> {
  const db = getDb();
  const threadId = email.threadId;
  let threadDeleted = false;

  await db.delete(emails).where(eq(emails.id, email.id));

  if (threadId) {
    const [{ remaining }] = await db
      .select({ remaining: count() })
      .from(emails)
      .where(eq(emails.threadId, threadId));

    if (remaining === 0) {
      await db.delete(emailThreads).where(eq(emailThreads.id, threadId));
      threadDeleted = true;
    } else {
      const [latest] = await db
        .select()
        .from(emails)
        .where(eq(emails.threadId, threadId))
        .orderBy(desc(emails.receivedAt))
        .limit(1);

      if (latest) {
        await db
          .update(emailThreads)
          .set({
            subject: latest.subject,
            lastMessageAt: latest.receivedAt,
          })
          .where(eq(emailThreads.id, threadId));
      }
    }
  }

  return { threadDeleted, threadId };
}

async function recordSyncExclusion(email: typeof emails.$inferSelect) {
  if (email.source !== "dedicated") return;

  const db = getDb();
  await db
    .insert(emailSyncExclusions)
    .values({
      gmailMessageId: email.gmailMessageId,
      messageIdHeader: email.messageIdHeader,
      excludedAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

export async function deleteEmailMessage(
  emailId: string,
  options: DeleteEmailOptions,
): Promise<DeleteEmailResult> {
  if (!options.deleteFromDb && !options.deleteFromGmail) {
    throw new Error("Choose at least one delete target.");
  }

  const db = getDb();

  const [email] = await db
    .select()
    .from(emails)
    .where(eq(emails.id, emailId));

  if (!email) {
    throw new Error("Email not found.");
  }

  const errors: string[] = [];
  let deletedFromDb = false;
  let deletedFromGmail = false;
  let threadDeleted = false;
  let threadId = email.threadId;

  if (options.deleteFromDb) {
    const dbResult = await removeEmailFromDb(email);
    deletedFromDb = true;
    threadDeleted = dbResult.threadDeleted;
    threadId = dbResult.threadId;

    if (!options.deleteFromGmail) {
      await recordSyncExclusion(email);
    }
  }

  if (options.deleteFromGmail) {
    if (email.source !== "dedicated") {
      errors.push(
        "Personal backfill messages cannot be removed from Gmail. Only the service database was updated.",
      );
    } else {
      try {
        await trashDedicatedGmailMessage(email.gmailMessageId);
        deletedFromGmail = true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not delete from Gmail.";
        if (/insufficient|permission|scope|403/i.test(message)) {
          errors.push(
            "Dedicated Gmail is missing delete permission. Reconnect the dedicated mailbox in Email Settings.",
          );
        } else {
          errors.push(message);
        }
      }
    }
  }

  if (!deletedFromDb && !deletedFromGmail && errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  return {
    deletedFromDb,
    deletedFromGmail,
    threadDeleted,
    threadId,
    errors,
  };
}
