/** Persist and load Telegram HITL review rows. */

import { randomUUID } from "crypto";

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { telegramReviewItems } from "@/lib/db/schema";
import type {
  AffiliationReviewPayload,
  ContactReviewPayload,
  TelegramReviewKind,
  TelegramReviewStatus,
} from "@/lib/telegram/types";

export type TelegramReviewRow = {
  id: string;
  kind: TelegramReviewKind;
  status: TelegramReviewStatus;
  holdReason: string;
  payloadJson: string;
  affiliationId: string | null;
  fingerprintMergeId: string | null;
  telegramChatId: string | null;
  telegramMessageId: number | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedVia: "telegram" | "ui" | null;
};

function asKind(value: string): TelegramReviewKind {
  return value === "affiliation" ? "affiliation" : "contact_identity";
}

function asStatus(value: string): TelegramReviewStatus {
  if (value === "approved" || value === "denied") return value;
  return "pending";
}

function mapRow(
  row: typeof telegramReviewItems.$inferSelect,
): TelegramReviewRow {
  return {
    id: row.id,
    kind: asKind(row.kind),
    status: asStatus(row.status),
    holdReason: row.holdReason,
    payloadJson: row.payloadJson,
    affiliationId: row.affiliationId,
    fingerprintMergeId: row.fingerprintMergeId,
    telegramChatId: row.telegramChatId,
    telegramMessageId: row.telegramMessageId,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewedVia: row.reviewedVia === "ui" ? "ui" : row.reviewedVia === "telegram" ? "telegram" : null,
  };
}

export async function insertContactReviewItem(input: {
  holdReason: string;
  payload: ContactReviewPayload;
  fingerprintMergeId: string | null;
}): Promise<TelegramReviewRow> {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await db.insert(telegramReviewItems).values({
    id,
    kind: "contact_identity",
    status: "pending",
    holdReason: input.holdReason,
    payloadJson: JSON.stringify(input.payload),
    affiliationId: null,
    fingerprintMergeId: input.fingerprintMergeId,
    telegramChatId: null,
    telegramMessageId: null,
    createdAt,
    reviewedAt: null,
    reviewedVia: null,
  });
  const [row] = await db
    .select()
    .from(telegramReviewItems)
    .where(eq(telegramReviewItems.id, id))
    .limit(1);
  return mapRow(row!);
}

export async function insertAffiliationReviewItem(input: {
  holdReason: string;
  payload: AffiliationReviewPayload;
  affiliationId: string;
}): Promise<TelegramReviewRow | null> {
  const db = getDb();
  const existing = await db
    .select()
    .from(telegramReviewItems)
    .where(eq(telegramReviewItems.affiliationId, input.affiliationId))
    .limit(1);
  if (existing[0]) return mapRow(existing[0]);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await db.insert(telegramReviewItems).values({
      id,
      kind: "affiliation",
      status: "pending",
      holdReason: input.holdReason,
      payloadJson: JSON.stringify(input.payload),
      affiliationId: input.affiliationId,
      fingerprintMergeId: null,
      telegramChatId: null,
      telegramMessageId: null,
      createdAt,
      reviewedAt: null,
      reviewedVia: null,
    });
  } catch {
    const [again] = await db
      .select()
      .from(telegramReviewItems)
      .where(eq(telegramReviewItems.affiliationId, input.affiliationId))
      .limit(1);
    return again ? mapRow(again) : null;
  }

  const [row] = await db
    .select()
    .from(telegramReviewItems)
    .where(eq(telegramReviewItems.id, id))
    .limit(1);
  return row ? mapRow(row) : null;
}

export async function listUnsentPendingReviewItems(): Promise<
  TelegramReviewRow[]
> {
  const db = getDb();
  const rows = await db
    .select()
    .from(telegramReviewItems)
    .where(
      and(
        eq(telegramReviewItems.status, "pending"),
        isNull(telegramReviewItems.telegramMessageId),
      ),
    );
  return rows.map(mapRow);
}

export async function getTelegramReviewItem(
  id: string,
): Promise<TelegramReviewRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(telegramReviewItems)
    .where(eq(telegramReviewItems.id, id))
    .limit(1);
  return row ? mapRow(row) : null;
}

export async function markTelegramReviewSent(input: {
  id: string;
  chatId: string;
  messageId: number;
}): Promise<void> {
  const db = getDb();
  await db
    .update(telegramReviewItems)
    .set({
      telegramChatId: input.chatId,
      telegramMessageId: input.messageId,
    })
    .where(eq(telegramReviewItems.id, input.id));
}

export async function markTelegramReviewResolved(input: {
  id: string;
  status: "approved" | "denied";
  via: "telegram" | "ui";
}): Promise<void> {
  const db = getDb();
  await db
    .update(telegramReviewItems)
    .set({
      status: input.status,
      reviewedAt: new Date().toISOString(),
      reviewedVia: input.via,
    })
    .where(eq(telegramReviewItems.id, input.id));
}
