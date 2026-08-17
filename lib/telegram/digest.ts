/** Send unsent pending HITL items after harvest. */

import { isTelegramHitlReady, listTelegramChatIds } from "@/lib/telegram/recipients";
import {
  markTelegramReviewSent,
  listUnsentPendingReviewItems,
} from "@/lib/telegram/store";
import {
  formatReviewItemMessage,
  reviewItemKeyboard,
} from "@/lib/telegram/format";
import { sendTelegramMessage } from "@/lib/telegram/api";

export async function sendUnsentTelegramDigest(): Promise<{
  sent: number;
  skipped: number;
  error: string | null;
}> {
  if (!(await isTelegramHitlReady())) {
    return { sent: 0, skipped: 0, error: null };
  }

  const chatIds = await listTelegramChatIds();
  const pending = await listUnsentPendingReviewItems();
  if (pending.length === 0 || chatIds.length === 0) {
    return { sent: 0, skipped: 0, error: null };
  }

  let sent = 0;
  let skipped = 0;
  let error: string | null = null;

  for (const item of pending) {
    try {
      const text = formatReviewItemMessage(item);
      const replyMarkup = reviewItemKeyboard(item.id);
      let lastDelivered: { chatId: string; messageId: number } | null = null;
      for (const chatId of chatIds) {
        lastDelivered = await sendTelegramMessage({
          chatId,
          text,
          replyMarkup,
        });
      }
      if (lastDelivered) {
        await markTelegramReviewSent({
          id: item.id,
          chatId: lastDelivered.chatId,
          messageId: lastDelivered.messageId,
        });
        sent += 1;
      }
    } catch (err) {
      skipped += 1;
      error = err instanceof Error ? err.message : "Telegram send failed.";
      console.error("[telegram] Could not send review item", item.id, error);
    }
  }

  return { sent, skipped, error };
}
