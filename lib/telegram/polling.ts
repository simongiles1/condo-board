/** Long-poll Telegram getUpdates when no webhook URL is configured. */

import {
  getTelegramUpdates,
  registerTelegramWebhook,
} from "@/lib/telegram/api";
import {
  getTelegramWebhookUrl,
  isTelegramBotConfigured,
  shouldPollTelegram,
} from "@/lib/telegram/config";
import { handleTelegramUpdate } from "@/lib/telegram/handle-update";

let polling = false;
let offset = 0;

async function pollLoop(): Promise<void> {
  while (polling) {
    try {
      const updates = await getTelegramUpdates({
        offset,
        timeout: 25,
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleTelegramUpdate(update);
        } catch (error) {
          console.error("[telegram-poll] Update failed", error);
        }
      }
    } catch (error) {
      console.error("[telegram-poll] getUpdates failed", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

export function startTelegramPolling(): void {
  if (!shouldPollTelegram()) return;
  if (polling) return;
  polling = true;
  console.info("[telegram-poll] Long-polling for callback queries");
  void pollLoop();
}

export function startTelegramRuntime(): void {
  if (!isTelegramBotConfigured()) return;
  if (getTelegramWebhookUrl()) {
    void registerTelegramWebhook().catch((error) => {
      console.error("[telegram] Webhook register failed", error);
    });
    return;
  }
  startTelegramPolling();
}
