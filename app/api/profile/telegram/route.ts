export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { updateUserNames } from "@/lib/auth/session";
import { getTelegramBotIdentity } from "@/lib/telegram/api";
import { isTelegramBotConfigured } from "@/lib/telegram/config";
import {
  getUserTelegramChatId,
  updateUserTelegramChatId,
} from "@/lib/telegram/recipients";

export async function GET() {
  const user = await requireSession();
  if (isErrorResponse(user)) return user;

  const chatId = await getUserTelegramChatId(user.id);
  const bot = await getTelegramBotIdentity();
  return NextResponse.json({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    chatId,
    botConfigured: isTelegramBotConfigured(),
    botUsername: bot?.username ?? null,
  });
}

export async function PATCH(request: Request) {
  const user = await requireSession();
  if (isErrorResponse(user)) return user;

  let body: {
    chatId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const nameResult = await updateUserNames({
    userId: user.id,
    firstName: body.firstName ?? null,
    lastName: body.lastName ?? null,
  });
  if ("error" in nameResult) {
    return NextResponse.json({ error: nameResult.error }, { status: 400 });
  }

  const result = await updateUserTelegramChatId({
    userId: user.id,
    chatId: body.chatId ?? null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    email: user.email,
    firstName: body.firstName?.trim() || null,
    lastName: body.lastName?.trim() || null,
    chatId: result.chatId,
    botConfigured: isTelegramBotConfigured(),
  });
}
