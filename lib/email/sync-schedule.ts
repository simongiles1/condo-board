export type SyncFrequency = "daily" | "weekdays" | "weekly";

export type SyncSchedule = {
  frequency: SyncFrequency;
  hour: number;
  minute: number;
  dayOfWeek: number;
};

export type ParsedSyncSchedule =
  | { kind: "preset"; schedule: SyncSchedule }
  | { kind: "custom"; cron: string; description: string };

export const DEFAULT_SYNC_SCHEDULE: SyncSchedule = {
  frequency: "daily",
  hour: 7,
  minute: 0,
  dayOfWeek: 1,
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function clampHour(value: number) {
  return Math.min(23, Math.max(0, value));
}

function clampMinute(value: number) {
  return Math.min(59, Math.max(0, value));
}

function normalizeDayOfWeek(value: number) {
  if (value === 7) return 0;
  return Math.min(6, Math.max(0, value));
}

export function syncScheduleToCron(schedule: SyncSchedule): string {
  const minute = clampMinute(schedule.minute);
  const hour = clampHour(schedule.hour);

  switch (schedule.frequency) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${normalizeDayOfWeek(schedule.dayOfWeek)}`;
  }
}

export function parseSyncSchedule(cron: string): ParsedSyncSchedule {
  const trimmed = cron.trim();

  const dailyMatch = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(trimmed);
  if (dailyMatch) {
    return {
      kind: "preset",
      schedule: {
        frequency: "daily",
        minute: clampMinute(Number(dailyMatch[1])),
        hour: clampHour(Number(dailyMatch[2])),
        dayOfWeek: DEFAULT_SYNC_SCHEDULE.dayOfWeek,
      },
    };
  }

  const weekdaysMatch = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(trimmed);
  if (weekdaysMatch) {
    return {
      kind: "preset",
      schedule: {
        frequency: "weekdays",
        minute: clampMinute(Number(weekdaysMatch[1])),
        hour: clampHour(Number(weekdaysMatch[2])),
        dayOfWeek: DEFAULT_SYNC_SCHEDULE.dayOfWeek,
      },
    };
  }

  const weeklyMatch = /^(\d{1,2}) (\d{1,2}) \* \* (\d)$/.exec(trimmed);
  if (weeklyMatch) {
    return {
      kind: "preset",
      schedule: {
        frequency: "weekly",
        minute: clampMinute(Number(weeklyMatch[1])),
        hour: clampHour(Number(weeklyMatch[2])),
        dayOfWeek: normalizeDayOfWeek(Number(weeklyMatch[3])),
      },
    };
  }

  return {
    kind: "custom",
    cron: trimmed,
    description: describeCustomCron(trimmed),
  };
}

function describeCustomCron(cron: string) {
  return `Custom schedule (${cron})`;
}

export function formatSyncTime(hour: number, minute: number) {
  const date = new Date();
  date.setHours(clampHour(hour), clampMinute(minute), 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function describeSyncSchedule(schedule: SyncSchedule) {
  const timeLabel = formatSyncTime(schedule.hour, schedule.minute);

  switch (schedule.frequency) {
    case "daily":
      return `Every day at ${timeLabel}`;
    case "weekdays":
      return `Every weekday at ${timeLabel}`;
    case "weekly":
      return `Every ${DAY_NAMES[normalizeDayOfWeek(schedule.dayOfWeek)]} at ${timeLabel}`;
  }
}

export function scheduleFromTimeInput(value: string, fallback: SyncSchedule) {
  const [hourPart, minutePart] = value.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return fallback;
  }

  return {
    ...fallback,
    hour: clampHour(hour),
    minute: clampMinute(minute),
  };
}

export function timeInputFromSchedule(schedule: SyncSchedule) {
  const hour = String(clampHour(schedule.hour)).padStart(2, "0");
  const minute = String(clampMinute(schedule.minute)).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function describeSyncCron(cron: string) {
  const parsed = parseSyncSchedule(cron);
  if (parsed.kind === "preset") {
    return describeSyncSchedule(parsed.schedule);
  }
  return parsed.description;
}

export function dayOfWeekOptions() {
  return DAY_NAMES.map((label, value) => ({ label, value }));
}
