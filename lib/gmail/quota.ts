/** Gmail user-rate / query-cost quota handling. */

const QUOTA_MESSAGE =
  /quota exceeded|ratelimitexceeded|userratelimitexceeded/i;

const HISTORY_CURSOR_NOTE =
  /history cursor was not advanced/i;

export function isGmailQuotaError(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  const code =
    error && typeof error === "object" && "code" in error
      ? Number((error as { code?: unknown }).code)
      : NaN;
  if (status === 429 || code === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return QUOTA_MESSAGE.test(message);
}

export function isGmailQuotaErrorMessage(message: string): boolean {
  return QUOTA_MESSAGE.test(message);
}

/**
 * Collapse dozens of identical per-message quota lines so Telegram and sync
 * history stay readable. Keep non-quota errors intact.
 */
export function summarizeGmailSyncErrors(errors: string[]): string[] {
  const quotaLines = errors.filter(isGmailQuotaErrorMessage);
  if (quotaLines.length <= 2) return errors;

  const rest = errors.filter(
    (line) =>
      !isGmailQuotaErrorMessage(line) && !HISTORY_CURSOR_NOTE.test(line),
  );
  rest.push(
    `Gmail API quota exceeded on ${quotaLines.length} fetches (units per minute per user). History cursor was not advanced; the next sync will retry.`,
  );
  return rest;
}

const DEFAULT_QUOTA_WAITS_MS = [15_000, 30_000, 60_000, 60_000];

export async function withGmailQuotaRetry<T>(
  fn: () => Promise<T>,
  options?: {
    sleep?: (ms: number) => Promise<void>;
    waitsMs?: number[];
  },
): Promise<T> {
  const waits = options?.waitsMs ?? DEFAULT_QUOTA_WAITS_MS;
  const sleep =
    options?.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt <= waits.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isGmailQuotaError(error) || attempt === waits.length) {
        throw error;
      }
      const waitMs = waits[attempt]!;
      console.warn(
        `[gmail] quota exceeded; waiting ${waitMs}ms (attempt ${attempt + 1}/${waits.length})`,
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
}
