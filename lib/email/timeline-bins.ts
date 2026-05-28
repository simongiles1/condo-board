import { DISPLAY_TIME_ZONE } from "@/lib/format/datetime";

export type TimelineBinSize = "week" | "month";

export type TimelineBin = {
  key: string;
  label: string;
  count: number;
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

export function binEmailsByTime(
  receivedAtValues: string[],
  binSize: TimelineBinSize,
): TimelineBin[] {
  const counts = new Map<string, number>();

  for (const receivedAt of receivedAtValues) {
    const key =
      binSize === "month" ? monthStartKey(receivedAt) : weekStartKey(receivedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return fillBins(counts, binSize);
}
