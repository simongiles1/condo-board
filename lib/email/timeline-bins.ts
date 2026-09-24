import { DISPLAY_TIME_ZONE } from "@/lib/format/datetime";

export type TimelineBinSize =
  | "week"
  | "month"
  | "month_avg_2"
  | "month_avg_3";

/** Month-based modes (calendar month or rolling average on monthly bins). */
export function timelineUsesMonthlyBins(binSize: TimelineBinSize): boolean {
  return binSize !== "week";
}

export function timelineRollingAverageMonths(
  binSize: TimelineBinSize,
): number | null {
  if (binSize === "month_avg_2") return 2;
  if (binSize === "month_avg_3") return 3;
  return null;
}

export type TimelineBin = {
  key: string;
  label: string;
  count: number;
};

/** One time bin with per-person counts (distinct emails in `count`). */
export type TimelineMultiBin = TimelineBin & {
  bySenderId: Record<string, number>;
};

type TorontoYmd = {
  y: number;
  m: number;
  d: number;
  dow: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function torontoYmd(iso: string): TorontoYmd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date(iso));

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    dow: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

function ymdKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function addDays(y: number, m: number, d: number, days: number): TorontoYmd {
  const date = new Date(y, m - 1, d + days);
  return {
    y: date.getFullYear(),
    m: date.getMonth() + 1,
    d: date.getDate(),
    dow: date.getDay(),
  };
}

function parseYmdKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function parseMonthKey(key: string): { y: number; m: number } {
  const [y, m] = key.split("-").map(Number);
  return { y, m };
}

function weekStartKey(iso: string): string {
  const { y, m, d, dow } = torontoYmd(iso);
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const start = addDays(y, m, d, -daysFromMonday);
  return ymdKey(start.y, start.m, start.d);
}

function monthStartKey(iso: string): string {
  const { y, m } = torontoYmd(iso);
  return monthKey(y, m);
}

function nextWeekKey(key: string): string {
  const { y, m, d } = parseYmdKey(key);
  const next = addDays(y, m, d, 7);
  return ymdKey(next.y, next.m, next.d);
}

function nextMonthKey(key: string): string {
  const { y, m } = parseMonthKey(key);
  const totalMonths = y * 12 + (m - 1) + 1;
  const nextY = Math.floor(totalMonths / 12);
  const nextM = (totalMonths % 12) + 1;
  return monthKey(nextY, nextM);
}

function formatMonthLabel(key: string): string {
  const { y, m } = parseMonthKey(key);
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function formatWeekLabel(key: string): string {
  const { y, m, d } = parseYmdKey(key);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  });
  const startLabel = fmt.format(start);
  const endLabel = fmt.format(end);
  const yearLabel = start.getFullYear() === end.getFullYear()
    ? String(start.getFullYear())
    : `${start.getFullYear()}–${end.getFullYear()}`;
  return `${startLabel}–${endLabel}, ${yearLabel}`;
}

function fillBins(
  counts: Map<string, number>,
  binSize: TimelineBinSize,
): TimelineBin[] {
  if (counts.size === 0) return [];

  const keys = [...counts.keys()].sort();
  const filled: TimelineBin[] = [];

  let cursor = keys[0];
  const last = keys[keys.length - 1];

  while (true) {
    filled.push({
      key: cursor,
      label:
        binSize === "month" ? formatMonthLabel(cursor) : formatWeekLabel(cursor),
      count: counts.get(cursor) ?? 0,
    });

    if (cursor === last) break;
    cursor = binSize === "month" ? nextMonthKey(cursor) : nextWeekKey(cursor);
  }

  return filled;
}

/**
 * Replaces each bin with the mean of itself and prior months back to the window
 * size (partial window at the start of the series).
 */
export function applyMonthlyRollingAverage(
  bins: TimelineBin[],
  windowMonths: number,
): TimelineBin[] {
  if (windowMonths <= 1 || bins.length === 0) return bins;

  return bins.map((bin, index) => {
    const start = Math.max(0, index - windowMonths + 1);
    const slice = bins.slice(start, index + 1);
    const count =
      slice.reduce((sum, entry) => sum + entry.count, 0) / slice.length;
    return { ...bin, count };
  });
}

/**
 * Rolling monthly average for multi-series bins (per sender and total distinct).
 */
export function applyMonthlyRollingAverageMulti(
  bins: TimelineMultiBin[],
  windowMonths: number,
): TimelineMultiBin[] {
  if (windowMonths <= 1 || bins.length === 0) return bins;

  return bins.map((bin, index) => {
    const start = Math.max(0, index - windowMonths + 1);
    const slice = bins.slice(start, index + 1);

    const count =
      slice.reduce((sum, entry) => sum + entry.count, 0) / slice.length;

    const senderIds = new Set<string>();
    for (const entry of slice) {
      for (const senderId of Object.keys(entry.bySenderId)) {
        senderIds.add(senderId);
      }
    }

    const bySenderId: Record<string, number> = {};
    for (const senderId of senderIds) {
      bySenderId[senderId] =
        slice.reduce(
          (sum, entry) => sum + (entry.bySenderId[senderId] ?? 0),
          0,
        ) / slice.length;
    }

    return { ...bin, count, bySenderId };
  });
}

function finalizeTimelineBins(
  bins: TimelineBin[],
  binSize: TimelineBinSize,
): TimelineBin[] {
  const windowMonths = timelineRollingAverageMonths(binSize);
  if (!windowMonths) return bins;
  return applyMonthlyRollingAverage(bins, windowMonths);
}

function finalizeTimelineMultiBins(
  bins: TimelineMultiBin[],
  binSize: TimelineBinSize,
): TimelineMultiBin[] {
  const windowMonths = timelineRollingAverageMonths(binSize);
  if (!windowMonths) return bins;
  return applyMonthlyRollingAverageMulti(bins, windowMonths);
}

export function binEmailsByTime(
  receivedAtValues: string[],
  binSize: TimelineBinSize,
): TimelineBin[] {
  const counts = new Map<string, number>();
  const monthly = timelineUsesMonthlyBins(binSize);

  for (const receivedAt of receivedAtValues) {
    const key = monthly ? monthStartKey(receivedAt) : weekStartKey(receivedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const fillSize: TimelineBinSize = monthly ? "month" : "week";
  return finalizeTimelineBins(fillBins(counts, fillSize), binSize);
}

/**
 * Returns true when a message From or Cc header contains the sender email
 * (case-insensitive substring match, same rule as inbox address filters).
 */
export function messageMatchesTimelineSender(
  fromAddress: string,
  ccAddresses: string,
  senderEmail: string,
): boolean {
  const needle = senderEmail.toLowerCase();
  return (
    fromAddress.toLowerCase().includes(needle) ||
    ccAddresses.toLowerCase().includes(needle)
  );
}

/**
 * Bins messages by time with separate counts per sender id; `count` is distinct
 * messages in the bin (not the sum of per-sender slices).
 */
export function binEmailsByTimeMulti(
  messages: Array<{ receivedAt: string; senderIds: string[] }>,
  binSize: TimelineBinSize,
): TimelineMultiBin[] {
  const distinctByKey = new Map<string, number>();
  const senderByKey = new Map<string, Map<string, number>>();
  const monthly = timelineUsesMonthlyBins(binSize);

  for (const message of messages) {
    const key = monthly
      ? monthStartKey(message.receivedAt)
      : weekStartKey(message.receivedAt);

    distinctByKey.set(key, (distinctByKey.get(key) ?? 0) + 1);

    let senderCounts = senderByKey.get(key);
    if (!senderCounts) {
      senderCounts = new Map();
      senderByKey.set(key, senderCounts);
    }

    for (const senderId of message.senderIds) {
      senderCounts.set(senderId, (senderCounts.get(senderId) ?? 0) + 1);
    }
  }

  if (distinctByKey.size === 0) return [];

  const keys = [...distinctByKey.keys()].sort();
  const filled: TimelineMultiBin[] = [];

  let cursor = keys[0];
  const last = keys[keys.length - 1];

  while (true) {
    const senderCounts = senderByKey.get(cursor);
    const bySenderId: Record<string, number> = {};
    if (senderCounts) {
      for (const [senderId, value] of senderCounts) {
        bySenderId[senderId] = value;
      }
    }

    filled.push({
      key: cursor,
      label: monthly ? formatMonthLabel(cursor) : formatWeekLabel(cursor),
      count: distinctByKey.get(cursor) ?? 0,
      bySenderId,
    });

    if (cursor === last) break;
    cursor = monthly ? nextMonthKey(cursor) : nextWeekKey(cursor);
  }

  return finalizeTimelineMultiBins(filled, binSize);
}
