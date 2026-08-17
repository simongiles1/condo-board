/** Telegram bot env. Chat ids live on app_users, not in env. */

export function getTelegramBotToken(): string | null {
  const value = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return value ? value : null;
}

export function getTelegramWebhookSecret(): string | null {
  const value = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return value ? value : null;
}

export function getTelegramWebhookUrl(): string | null {
  const value = process.env.TELEGRAM_WEBHOOK_URL?.trim();
  return value ? value : null;
}

export function isTelegramBotConfigured(): boolean {
  return Boolean(getTelegramBotToken());
}

export function shouldPollTelegram(): boolean {
  return isTelegramBotConfigured() && !getTelegramWebhookUrl();
}

/** Telegram user/group chat ids are signed 64-bit integers. */
export function normalizeTelegramChatId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (!/^-?\d{1,20}$/.test(trimmed)) return null;
  if (trimmed === "-" || trimmed === "0" || trimmed === "-0") return null;
  return trimmed;
}
