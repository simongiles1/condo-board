/** Thin Telegram Bot API client (sendMessage + callback answers). */

import {
  getTelegramBotToken,
  getTelegramWebhookSecret,
  getTelegramWebhookUrl,
} from "@/lib/telegram/config";

const TELEGRAM_API = "https://api.telegram.org";

export type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramSendResult = {
  messageId: number;
  chatId: string;
};

async function telegramCall<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = getTelegramBotToken();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  }

  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
  if (!json.ok || json.result === undefined) {
    throw new Error(json.description ?? `Telegram ${method} failed.`);
  }
  return json.result;
}

export async function sendTelegramMessage(input: {
  text: string;
  chatId: string;
  replyMarkup?: TelegramInlineKeyboard;
}): Promise<TelegramSendResult> {
  const chatId = input.chatId.trim();
  if (!chatId) {
    throw new Error("Telegram chat id is required.");
  }

  const result = await telegramCall<{ message_id: number; chat: { id: number } }>(
    "sendMessage",
    {
      chat_id: chatId,
      text: input.text,
      disable_web_page_preview: true,
      reply_markup: input.replyMarkup,
    },
  );

  return {
    messageId: result.message_id,
    chatId: String(result.chat.id),
  };
}

export async function editTelegramMessage(input: {
  chatId: string;
  messageId: number;
  text: string;
}): Promise<void> {
  try {
    await telegramCall("editMessageText", {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/message is not modified/i.test(message)) {
      throw error;
    }
  }
}

export async function answerTelegramCallback(input: {
  callbackQueryId: string;
  text: string;
}): Promise<void> {
  await telegramCall("answerCallbackQuery", {
    callback_query_id: input.callbackQueryId,
    text: input.text,
  });
}

export async function getTelegramUpdates(input: {
  offset?: number;
  timeout?: number;
}): Promise<TelegramUpdate[]> {
  return telegramCall<TelegramUpdate[]>("getUpdates", {
    offset: input.offset,
    timeout: input.timeout ?? 25,
    allowed_updates: ["callback_query", "message"],
  });
}

export async function registerTelegramWebhook(): Promise<void> {
  const url = getTelegramWebhookUrl();
  if (!url) return;
  await telegramCall("setWebhook", {
    url,
    secret_token: getTelegramWebhookSecret() ?? undefined,
    allowed_updates: ["callback_query", "message"],
  });
}

export async function getTelegramBotIdentity(): Promise<{
  id: number;
  username: string | null;
  firstName: string | null;
} | null> {
  if (!getTelegramBotToken()) return null;
  try {
    const result = await telegramCall<{
      id: number;
      username?: string;
      first_name?: string;
    }>("getMe", {});
    return {
      id: result.id,
      username: result.username?.trim() || null,
      firstName: result.first_name?.trim() || null,
    };
  } catch {
    return null;
  }
}

/** Telegram will not DM a user until they have opened this bot and tapped Start. */
export function explainTelegramSendFailure(
  raw: string,
  botUsername?: string | null,
): string {
  const bot = botUsername?.replace(/^@/, "") || null;
  const botHint = bot
    ? ` Open @${bot} in Telegram, tap Start, then try again.`
    : " Open this Condo Board bot in Telegram, tap Start, then try again.";
  if (/chat not found/i.test(raw) || /can't initiate conversation/i.test(raw)) {
    return `Telegram has not seen your chat yet.${botHint} A chat ID from @userinfobot is not enough until you have messaged this bot.`;
  }
  if (/blocked by the user/i.test(raw)) {
    return "This bot is blocked in Telegram. Unblock it, send /start, then try again.";
  }
  return raw;
}

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: { id: number; username?: string };
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
};

export type TelegramIncomingMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type?: string };
};

export type TelegramUpdate = {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
  message?: TelegramIncomingMessage;
};
