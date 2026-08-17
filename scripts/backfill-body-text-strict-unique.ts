/**
 * Backfill emails.body_text_strict_unique (and body_text_unique when missing)
 * so evidence panels and email sidebars avoid recomputing thread diffs on every request.
 *
 * Usage: npm run backfill:body-text-strict-unique
 */

import { readFileSync } from "fs";

import { asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emails } from "@/lib/db/schema";
import {
  computeThreadAuthoredBodies,
  computeThreadUniqueBodies,
} from "@/lib/email/thread-unique-content";

function loadDatabaseUrl(): string {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.slice("DATABASE_URL=".length).trim();
      }
    }
  } catch {
    // optional when env is already set
  }

  return (
    process.env.DATABASE_URL ??
    "postgresql://condo:condo@localhost:5433/condo_board"
  );
}

const BATCH_THREADS = 50;

async function main() {
  process.env.DATABASE_URL = loadDatabaseUrl();
  const db = getDb();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emails)
    .where(isNotNull(emails.threadId));
  const threadRows = await db
    .selectDistinct({ threadId: emails.threadId })
    .from(emails)
    .where(isNotNull(emails.threadId));

  const threadIds = threadRows
    .map((row) => row.threadId)
    .filter((id): id is string => Boolean(id));

  console.info(
    `[backfill-body-text-strict-unique] ${threadIds.length} threads, ${count} emails`,
  );

  let updated = 0;
  for (let offset = 0; offset < threadIds.length; offset += BATCH_THREADS) {
    const batch = threadIds.slice(offset, offset + BATCH_THREADS);
    const messages = await db
      .select({
        id: emails.id,
        threadId: emails.threadId,
        bodyText: emails.bodyText,
        bodyHtml: emails.bodyHtml,
        bodyTextUnique: emails.bodyTextUnique,
        bodyTextStrictUnique: emails.bodyTextStrictUnique,
        receivedAt: emails.receivedAt,
      })
      .from(emails)
      .where(inArray(emails.threadId, batch))
      .orderBy(asc(emails.receivedAt));

    const byThread = new Map<string, typeof messages>();
    for (const message of messages) {
      if (!message.threadId) continue;
      const list = byThread.get(message.threadId) ?? [];
      list.push(message);
      byThread.set(message.threadId, list);
    }

    for (const [, threadMessages] of byThread) {
      const authoredMap = computeThreadAuthoredBodies(
        threadMessages.map((m) => ({
          id: m.id,
          bodyText: m.bodyText,
          bodyHtml: m.bodyHtml,
          receivedAt: m.receivedAt,
        })),
      );
      const strictMap = computeThreadUniqueBodies(
        threadMessages.map((m) => ({
          id: m.id,
          bodyText: m.bodyText,
          bodyHtml: m.bodyHtml,
          receivedAt: m.receivedAt,
        })),
      );

      for (const message of threadMessages) {
        const authored = authoredMap.get(message.id) ?? message.bodyText;
        const strict = strictMap.get(message.id) ?? authored;
        const nextUnique = message.bodyTextUnique?.trim() ? message.bodyTextUnique : authored;
        const nextStrict = message.bodyTextStrictUnique?.trim()
          ? message.bodyTextStrictUnique
          : strict;
        if (
          nextUnique === message.bodyTextUnique &&
          nextStrict === message.bodyTextStrictUnique
        ) {
          continue;
        }
        await db
          .update(emails)
          .set({
            bodyTextUnique: nextUnique,
            bodyTextStrictUnique: nextStrict,
          })
          .where(eq(emails.id, message.id));
        updated += 1;
      }
    }

    console.info(
      `[backfill-body-text-strict-unique] ${Math.min(offset + BATCH_THREADS, threadIds.length)}/${threadIds.length} threads, ${updated} rows updated`,
    );
  }

  console.info(`[backfill-body-text-strict-unique] Done. Updated ${updated} emails.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
