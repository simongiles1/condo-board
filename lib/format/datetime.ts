const DISPLAY_LOCALE = "en-CA";
export const DISPLAY_TIME_ZONE = "America/Toronto";

function parseInstant(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * First HH:MM in a clock time, range (`09:00-17:00`), or ISO datetime.
 * Harvest sometimes stores a window instead of a single time.
 */
export function parseClockTime(
  value: string | null | undefined,
): { hour: number; minute: number } | null {
  if (!value) return null;
  const timePart = value.includes("T") ? (value.split("T")[1] ?? "") : value;
  const match = timePart.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Stable date-only formatting for SSR (avoids hydration mismatches). */
export function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseInstant(value);
  if (!date) return value;

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/** Stable date/time formatting for SSR (avoids hydration mismatches). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseInstant(value);
  if (!date) return value;

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/** Stable time-only formatting for SSR (avoids hydration mismatches). */
export function formatDisplayTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseInstant(value);
  if (!date) return value;

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/** Clock label for calendar list rows. Naive local time — not an instant. */
export function formatEventClockTime(
  startAt: string | null | undefined,
): string | null {
  const clock = parseClockTime(startAt);
  if (!clock) return null;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, clock.hour, clock.minute));
}

export function formatProcessingDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
