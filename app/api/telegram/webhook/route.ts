export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getTelegramWebhookSecret } from "@/lib/telegram/config";
import { handleTelegramUpdate } from "@/lib/telegram/handle-update";
import type { TelegramUpdate } from "@/lib/telegram/api";

export async function POST(request: Request) {
  const secret = getTelegramWebhookSecret();
  if (secret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token");
    if (header !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    await handleTelegramUpdate(update);
  } catch (error) {
    console.error("[telegram:webhook]", error);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
