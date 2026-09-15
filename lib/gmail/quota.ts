/** Gmail user-rate / query-cost quota handling and call metering. */

import { AsyncLocalStorage } from "node:async_hooks";

import {
  GMAIL_UNITS_PER_USER_PER_MINUTE,
  type GmailQuotaMethodRow,
  type GmailQuotaSnapshot,
} from "./quota-snapshot";

export {
  formatGmailQuotaDetail,
  GMAIL_UNITS_PER_USER_PER_MINUTE,
  parseGmailQuotaSnapshot,
  type GmailQuotaMethodRow,
  type GmailQuotaSnapshot,
} from "./quota-snapshot";

const QUOTA_MESSAGE =
  /quota exceeded|ratelimitexceeded|userratelimitexceeded/i;

const HISTORY_CURSOR_NOTE =
  /history cursor was not advanced/i;

/**
 * Official per-method quota units:
 * https://developers.google.com/workspace/gmail/api/reference/quota
 */
export const GMAIL_METHOD_UNITS: Record<string, number> = {
  getProfile: 1,
  "history.list": 2,
  "messages.attachments.get": 20,
  "messages.get": 20,
  "messages.list": 5,
  "messages.send": 100,
  "messages.trash": 20,
  "threads.get": 40,
  "threads.list": 10,
};

export function gmailMethodUnits(method: string): number {
  return GMAIL_METHOD_UNITS[method] ?? 1;
}

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

type MeterEvent = { at: number; method: string; units: number };

class GmailQuotaMeter {
  private readonly events: MeterEvent[] = [];

  record(method: string): void {
    this.events.push({
      at: Date.now(),
      method,
      units: gmailMethodUnits(method),
    });
  }

  snapshot(): GmailQuotaSnapshot {
    return snapshotFromEvents(this.events);
  }
}

export function snapshotFromEvents(events: MeterEvent[]): GmailQuotaSnapshot {
  const byMethodMap = new Map<string, GmailQuotaMethodRow>();
  let units = 0;
  for (const event of events) {
    units += event.units;
    const row = byMethodMap.get(event.method) ?? {
      method: event.method,
      calls: 0,
      units: 0,
    };
    row.calls += 1;
    row.units += event.units;
    byMethodMap.set(event.method, row);
  }
  const started = events[0]?.at ?? Date.now();
  const ended = events[events.length - 1]?.at ?? started;
  const durationMs = Math.max(0, ended - started);
  const peakUnitsIn60s = peakUnitsInWindow(events, 60_000);
  const percentOfLimit = Math.round(
    (peakUnitsIn60s / GMAIL_UNITS_PER_USER_PER_MINUTE) * 100,
  );
  const byMethod = [...byMethodMap.values()].sort((a, b) => b.units - a.units);
  return {
    calls: events.length,
    units,
    durationMs,
    peakUnitsIn60s,
    limitUnitsPerUserPerMinute: GMAIL_UNITS_PER_USER_PER_MINUTE,
    percentOfLimit,
    byMethod,
  };
}

export function peakUnitsInWindow(
  events: Array<{ at: number; units: number }>,
  windowMs: number,
): number {
  if (events.length === 0) return 0;
  let peak = 0;
  let windowSum = 0;
  let left = 0;
  for (let right = 0; right < events.length; right += 1) {
    windowSum += events[right]!.units;
    while (events[right]!.at - events[left]!.at > windowMs) {
      windowSum -= events[left]!.units;
      left += 1;
    }
    if (windowSum > peak) peak = windowSum;
  }
  return peak;
}

const meterStore = new AsyncLocalStorage<GmailQuotaMeter>();

export function recordGmailApiCall(method: string): void {
  meterStore.getStore()?.record(method);
}

export function snapshotGmailQuotaMeter(): GmailQuotaSnapshot | null {
  return meterStore.getStore()?.snapshot() ?? null;
}

export async function runWithGmailQuotaMeter<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: GmailQuotaSnapshot }> {
  const existing = meterStore.getStore();
  if (existing) {
    const result = await fn();
    return { result, usage: existing.snapshot() };
  }
  const meter = new GmailQuotaMeter();
  return meterStore.run(meter, async () => {
    const result = await fn();
    return { result, usage: meter.snapshot() };
  });
}
