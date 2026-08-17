/** Handle Telegram callback_query updates (webhook or long poll). */

import { isAllowedTelegramChatId } from "@/lib/telegram/recipients";
import {
  answerTelegramCallback,
  editTelegramMessage,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram/api";
import {
  formatResolvedMessage,
  parseTelegramCallbackData,
} from "@/lib/telegram/format";
import { getTelegramReviewItem } from "@/lib/telegram/store";
import { resolveTelegramReviewItem } from "@/lib/telegram/resolve";
import { sendUnsentTelegramDigest } from "@/lib/telegram/digest";

function isChatIdCommand(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  return trimmed === "/start" || trimmed.startsWith("/start ") || trimmed === "/id";
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
): Promise<void> {
  const incoming = update.message;
  if (incoming?.chat?.id != null && incoming.chat.type !== "group" && incoming.chat.type !== "supergroup") {
    if (isChatIdCommand(incoming.text)) {
      const chatId = String(incoming.chat.id);
      await sendTelegramMessage({
        chatId,
        text: `Your Condo Board chat ID is ${chatId}. Paste it in Profile, save, then send a test message.`,
      });
    }
    if (!update.callback_query) return;
  }

  const query = update.callback_query;
  if (!query?.id) return;

  const chatId = query.message?.chat.id != null ? String(query.message.chat.id) : null;
  if (!chatId || !(await isAllowedTelegramChatId(chatId))) {
    await answerTelegramCallback({
      callbackQueryId: query.id,
      text: "This chat is not authorized.",
    });
    return;
  }

  const parsed = parseTelegramCallbackData(query.data);
  if (!parsed) {
    await answerTelegramCallback({
      callbackQueryId: query.id,
      text: "Unknown button.",
    });
    return;
  }

  const result = await resolveTelegramReviewItem({
    id: parsed.id,
    action: parsed.action,
    via: "telegram",
  });

  await answerTelegramCallback({
    callbackQueryId: query.id,
    text: result.ok
      ? parsed.action === "approved"
        ? "Approved."
        : "Denied."
      : result.error,
  });

  if (result.ok && query.message && chatId) {
    const original =
      query.message.text ??
      (await getTelegramReviewItem(parsed.id).then((row) =>
        row ? `Review ${row.id}` : "Review item",
      ));
    await editTelegramMessage({
      chatId,
      messageId: query.message.message_id,
      text: formatResolvedMessage(original, parsed.action),
    });
  }

  // Contact approve/deny may have queued affiliation needs_review.
  await sendUnsentTelegramDigest();
}
