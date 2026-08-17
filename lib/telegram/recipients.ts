/** Load Telegram chat ids from user records. */

import { eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import {
  isTelegramBotConfigured,
  normalizeTelegramChatId,
} from "@/lib/telegram/config";

export async function listTelegramChatIds(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ telegramChatId: appUsers.telegramChatId })
    .from(appUsers)
    .where(isNotNull(appUsers.telegramChatId));

  const ids = new Set<string>();
  for (const row of rows) {
    const id = normalizeTelegramChatId(row.telegramChatId);
    if (id) ids.add(id);
  }
  return [...ids];
}

export async function isTelegramHitlReady(): Promise<boolean> {
  if (!isTelegramBotConfigured()) return false;
  const ids = await listTelegramChatIds();
  return ids.length > 0;
}

export async function isAllowedTelegramChatId(chatId: string): Promise<boolean> {
  const normalized = normalizeTelegramChatId(chatId);
  if (!normalized) return false;
  const ids = await listTelegramChatIds();
  return ids.includes(normalized);
}

export async function getUserTelegramChatId(
  userId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ telegramChatId: appUsers.telegramChatId })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return normalizeTelegramChatId(row?.telegramChatId);
}

export async function updateUserTelegramChatId(input: {
  userId: string;
  chatId: string | null;
}): Promise<{ ok: true; chatId: string | null } | { error: string }> {
  const normalized =
    input.chatId === null || input.chatId.trim() === ""
      ? null
      : normalizeTelegramChatId(input.chatId);
  if (input.chatId != null && input.chatId.trim() !== "" && !normalized) {
    return {
      error: "Chat ID must be the numeric id Telegram shows for your DM with the bot.",
    };
  }

  const db = getDb();
  const [target] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, input.userId))
    .limit(1);
  if (!target) return { error: "User not found." };

  await db
    .update(appUsers)
    .set({ telegramChatId: normalized })
    .where(eq(appUsers.id, input.userId));

  return { ok: true, chatId: normalized };
}
