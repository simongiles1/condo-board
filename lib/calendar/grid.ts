import { DISPLAY_TIME_ZONE } from "@/lib/format/datetime";

export type CalendarView = "month" | "week";

export type CalendarDisplayMode = "calendar" | "list";

export type CalendarDay = {
  key: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function parseYmd(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function ymdKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(y: number, m: number, d: number, days: number) {
  const date = new Date(y, m - 1, d + days);
  return {
    y: date.getFullYear(),
    m: date.getMonth() + 1,
    d: date.getDate(),
  };
}

function mondayOffset(dow: number): number {
  return dow === 0 ? 6 : dow - 1;
}

export function getTodayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function parseCalendarDate(value: string | null | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return getTodayKey();
}

export function parseCalendarView(
  value: string | null | undefined,
): CalendarView {
  return value === "week" ? "week" : "month";
}

export function parseCalendarDisplayMode(
  value: string | null | undefined,
): CalendarDisplayMode {
  return value === "list" ? "list" : "calendar";
}

export function buildMonthGrid(anchorKey: string): CalendarDay[] {
  const { y, m } = parseYmd(anchorKey);
  const firstDow = new Date(y, m - 1, 1).getDay();
  const start = addDays(y, m, 1, -mondayOffset(firstDow));
  const todayKey = getTodayKey();
  const days: CalendarDay[] = [];

  let cursor = start;
  for (let i = 0; i < 42; i++) {
    days.push({
      key: ymdKey(cursor.y, cursor.m, cursor.d),
      dayNumber: cursor.d,
      isCurrentMonth: cursor.y === y && cursor.m === m,
      isToday: ymdKey(cursor.y, cursor.m, cursor.d) === todayKey,
    });
    cursor = addDays(cursor.y, cursor.m, cursor.d, 1);
  }

  return days;
}

export function buildWeekDays(anchorKey: string): CalendarDay[] {
  const { y, m, d } = parseYmd(anchorKey);
  const dow = new Date(y, m - 1, d).getDay();
  const start = addDays(y, m, d, -mondayOffset(dow));
  const todayKey = getTodayKey();
  const days: CalendarDay[] = [];

  let cursor = start;
  for (let i = 0; i < 7; i++) {
    days.push({
      key: ymdKey(cursor.y, cursor.m, cursor.d),
      dayNumber: cursor.d,
      isCurrentMonth: true,
      isToday: ymdKey(cursor.y, cursor.m, cursor.d) === todayKey,
    });
    cursor = addDays(cursor.y, cursor.m, cursor.d, 1);
  }

  return days;
}

export function shiftCalendarDate(
  anchorKey: string,
  view: CalendarView,
  direction: "prev" | "next",
): string {
  const { y, m, d } = parseYmd(anchorKey);
  const delta = direction === "next" ? 1 : -1;

  if (view === "week") {
    const next = addDays(y, m, d, delta * 7);
    return ymdKey(next.y, next.m, next.d);
  }

  const totalMonths = y * 12 + (m - 1) + delta;
  const nextY = Math.floor(totalMonths / 12);
  const nextM = (totalMonths % 12) + 1;
  return ymdKey(nextY, nextM, 1);
}

export function formatMonthTitle(anchorKey: string): string {
  const { y, m } = parseYmd(anchorKey);
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatWeekTitle(anchorKey: string): string {
  const days = buildWeekDays(anchorKey);
  const start = parseYmd(days[0].key);
  const end = parseYmd(days[6].key);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  });
  const startLabel = fmt.format(new Date(start.y, start.m - 1, start.d));
  const endLabel = fmt.format(new Date(end.y, end.m - 1, end.d));
  const yearLabel =
    start.y === end.y ? String(start.y) : `${start.y}–${end.y}`;
  return `${startLabel}–${endLabel}, ${yearLabel}`;
}

export function calendarHref(
  view: CalendarView,
  date: string,
  display: CalendarDisplayMode = "calendar",
): string {
  const params = new URLSearchParams({ view, date });
  if (display === "list") {
    params.set("display", "list");
  }
  return `/calendar?${params.toString()}`;
}

/** Pixel height of one hour row in the week view time grid. */
export const WEEK_HOUR_HEIGHT_PX = 48;

/** Hours shown in the week view (midnight through 11 PM). */
export const WEEK_VIEW_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function formatWeekHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

export { WEEKDAY_LABELS };
