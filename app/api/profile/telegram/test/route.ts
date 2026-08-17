export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  explainTelegramSendFailure,
  getTelegramBotIdentity,
  sendTelegramMessage,
} from "@/lib/telegram/api";
import { isTelegramBotConfigured } from "@/lib/telegram/config";
import { getUserTelegramChatId } from "@/lib/telegram/recipients";

export async function POST() {
  const user = await requireSession();
  if (isErrorResponse(user)) return user;

  if (!isTelegramBotConfigured()) {
    return NextResponse.json(
      {
        error:
          "Telegram bot token is not configured. Set TELEGRAM_BOT_TOKEN in the server environment.",
      },
      { status: 400 },
    );
  }

  const chatId = await getUserTelegramChatId(user.id);
  if (!chatId) {
    return NextResponse.json(
      { error: "Save your Telegram chat ID first." },
      { status: 400 },
    );
  }

  try {
    await sendTelegramMessage({
      chatId,
      text: "Condo Board bot connected. You will get harvest review prompts in this chat.",
    });
  } catch (error) {
    const raw =
      error instanceof Error ? error.message : "Could not send a test message.";
    const bot = await getTelegramBotIdentity();
    return NextResponse.json(
      { error: explainTelegramSendFailure(raw, bot?.username) },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
