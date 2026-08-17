import { DISPLAY_TIME_ZONE } from "@/lib/format/datetime";

export const EXTRACTION_CONCEPTS = [
  "attachment",
  "contact",
  "organization",
  "event",
  "equipment",
  "todo",
] as const;

export type ExtractionConceptId = (typeof EXTRACTION_CONCEPTS)[number];

export const EXTRACTION_CONCEPT_META: Record<
  ExtractionConceptId,
  { label: string; implemented: boolean; eligibleHint: string }
> = {
  attachment: {
    label: "Attachments",
    implemented: true,
    eligibleHint: "emails with a file",
  },
  contact: {
    label: "Contacts",
    implemented: true,
    eligibleHint: "every email",
  },
  organization: {
    label: "Organizations",
    implemented: true,
    eligibleHint: "every email",
  },
  event: {
    label: "Events",
    implemented: true,
    eligibleHint: "every email",
  },
  equipment: {
    label: "Equipment",
    implemented: false,
    eligibleHint: "every email",
  },
  todo: {
    label: "To-dos",
    implemented: true,
    eligibleHint: "every email",
  },
};

export type ConceptCount = {
  eligible: number;
  extracted: number;
};

export type EmailExtractionRow = {
  receivedAt: string;
  hasEligibleAttachment: boolean;
  attachmentsExtracted: boolean;
  contactExtracted: boolean;
  organizationExtracted: boolean;
  eventExtracted: boolean;
  todoExtracted: boolean;
};

export type ExtractionCalendarDay = {
  date: string;
  inYear: boolean;
  emailCount: number;
  concepts: Record<ExtractionConceptId, ConceptCount>;
};

export type ExtractionCalendarWeek = {
  monthLabel: string | null;
  days: ExtractionCalendarDay[];
};

export type ExtractionCalendarYear = {
  year: number;
  today: string;
  weeks: ExtractionCalendarWeek[];
  totals: Record<ExtractionConceptId, ConceptCount>;
  totalEmails: number;
};

export type ExtractionCalendarResponse = ExtractionCalendarYear & {
  years: number[];
  filtersActive: boolean;
};

export type SliverLevel =
  | "empty"
  | "none"
  | "low"
  | "mid"
  | "full"
  | "disabled";

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

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function emptyConcepts(): Record<ExtractionConceptId, ConceptCount> {
  return {
    attachment: { eligible: 0, extracted: 0 },
    contact: { eligible: 0, extracted: 0 },
    organization: { eligible: 0, extracted: 0 },
    event: { eligible: 0, extracted: 0 },
    equipment: { eligible: 0, extracted: 0 },
    todo: { eligible: 0, extracted: 0 },
  };
}

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

export function torontoDateKey(iso: string): string {
  const { y, m, d } = torontoYmd(iso);
  return ymdKey(y, m, d);
}

export function torontoTodayKey(now = new Date()): string {
  return torontoDateKey(now.toISOString());
}

export function torontoYear(iso: string): number {
  return torontoYmd(iso).y;
}

function ymdKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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

export function listExtractionCalendarYears(
  receivedAtValues: string[],
): number[] {
  const years = new Set<number>();
  for (const receivedAt of receivedAtValues) {
    years.add(torontoYear(receivedAt));
  }
  return [...years].sort((a, b) => b - a);
}

export function resolveExtractionCalendarYear(
  years: number[],
  requestedYear: number | null,
  todayYear: number,
): number {
  if (requestedYear && years.includes(requestedYear)) return requestedYear;
  if (years.includes(todayYear)) return todayYear;
  return years[0] ?? todayYear;
}

function applyEmailToDay(
  day: ExtractionCalendarDay,
  email: EmailExtractionRow,
): void {
  day.emailCount += 1;

  if (email.hasEligibleAttachment) {
    day.concepts.attachment.eligible += 1;
    if (email.attachmentsExtracted) day.concepts.attachment.extracted += 1;
  }

  day.concepts.contact.eligible += 1;
  if (email.contactExtracted) day.concepts.contact.extracted += 1;

  day.concepts.organization.eligible += 1;
  if (email.organizationExtracted) day.concepts.organization.extracted += 1;

  day.concepts.event.eligible += 1;
  if (email.eventExtracted) day.concepts.event.extracted += 1;

  day.concepts.todo.eligible += 1;
  if (email.todoExtracted) day.concepts.todo.extracted += 1;

  // Equipment is plotted so the lane exists, but nothing is extracted yet.
  day.concepts.equipment.eligible += 1;
}

export function aggregateExtractionDays(
  emails: EmailExtractionRow[],
): Map<string, ExtractionCalendarDay> {
  const days = new Map<string, ExtractionCalendarDay>();

  for (const email of emails) {
    const date = torontoDateKey(email.receivedAt);
    let day = days.get(date);
    if (!day) {
      day = {
        date,
        inYear: true,
        emailCount: 0,
        concepts: emptyConcepts(),
      };
      days.set(date, day);
    }
    applyEmailToDay(day, email);
  }

  return days;
}

function cloneDay(
  date: string,
  inYear: boolean,
  source: ExtractionCalendarDay | undefined,
): ExtractionCalendarDay {
  if (!source) {
    return {
      date,
      inYear,
      emailCount: 0,
      concepts: emptyConcepts(),
    };
  }

  return {
    date,
    inYear,
    emailCount: source.emailCount,
    concepts: {
      attachment: { ...source.concepts.attachment },
      contact: { ...source.concepts.contact },
      organization: { ...source.concepts.organization },
      event: { ...source.concepts.event },
      equipment: { ...source.concepts.equipment },
      todo: { ...source.concepts.todo },
    },
  };
}

function addConceptCounts(
  target: Record<ExtractionConceptId, ConceptCount>,
  source: Record<ExtractionConceptId, ConceptCount>,
): void {
  for (const concept of EXTRACTION_CONCEPTS) {
    target[concept].eligible += source[concept].eligible;
    target[concept].extracted += source[concept].extracted;
  }
}

/**
 * GitHub-style Sunday–Saturday week grid for one calendar year (Toronto).
 * Days outside the year pad the first/last week and stay unfilled.
 */
export function buildExtractionCalendarYear(
  dayStats: Map<string, ExtractionCalendarDay>,
  year: number,
  today = torontoTodayKey(),
): ExtractionCalendarYear {
  const jan1 = { y: year, m: 1, d: 1, dow: new Date(year, 0, 1).getDay() };
  const dec31 = {
    y: year,
    m: 12,
    d: 31,
    dow: new Date(year, 11, 31).getDay(),
  };
  const start = addDays(jan1.y, jan1.m, jan1.d, -jan1.dow);
  const end = addDays(dec31.y, dec31.m, dec31.d, 6 - dec31.dow);

  const weeks: ExtractionCalendarWeek[] = [];
  const totals = emptyConcepts();
  let totalEmails = 0;

  let cursor = start;
  let currentWeek: ExtractionCalendarDay[] = [];

  while (true) {
    const date = ymdKey(cursor.y, cursor.m, cursor.d);
    const inYear = cursor.y === year;
    const day = cloneDay(date, inYear, inYear ? dayStats.get(date) : undefined);
    currentWeek.push(day);

    if (inYear) {
      totalEmails += day.emailCount;
      addConceptCounts(totals, day.concepts);
    }

    if (currentWeek.length === 7) {
      const firstOfMonth = currentWeek.find((weekDay) => {
        if (!weekDay.inYear) return false;
        return parseYmdKey(weekDay.date).d === 1;
      });
      weeks.push({
        monthLabel: firstOfMonth
          ? MONTH_LABELS[parseYmdKey(firstOfMonth.date).m - 1] ?? null
          : null,
        days: currentWeek,
      });
      currentWeek = [];
    }

    if (date === ymdKey(end.y, end.m, end.d)) break;
    cursor = addDays(cursor.y, cursor.m, cursor.d, 1);
  }

  return {
    year,
    today,
    weeks,
    totals,
    totalEmails,
  };
}

export function buildExtractionCalendar(
  emails: EmailExtractionRow[],
  year: number,
  today = torontoTodayKey(),
): ExtractionCalendarYear {
  return buildExtractionCalendarYear(aggregateExtractionDays(emails), year, today);
}

export function conceptSliverLevel(
  concept: ExtractionConceptId,
  stat: ConceptCount,
): SliverLevel {
  if (!EXTRACTION_CONCEPT_META[concept].implemented) return "disabled";
  if (stat.eligible <= 0) return "empty";
  if (stat.extracted <= 0) return "none";
  const ratio = stat.extracted / stat.eligible;
  if (ratio >= 1) return "full";
  if (ratio >= 0.5) return "mid";
  return "low";
}

export type SliverPaint = "empty" | "low" | "mid" | "full" | "disabled";

/**
 * What to draw on a day stripe. Show missing is a filter: same lane colors,
 * but only unfinished eligible work is painted. Completed days stay blank.
 * Shade still means coverage: low = a partial gap, full = nothing extracted.
 */
export function conceptSliverPaint(
  concept: ExtractionConceptId,
  stat: ConceptCount,
  showMissing: boolean,
): SliverPaint {
  const level = conceptSliverLevel(concept, stat);
  if (level === "disabled" || level === "empty") return level;
  if (!showMissing) {
    if (level === "none") return "empty";
    return level;
  }

  const missing = stat.eligible - stat.extracted;
  if (missing <= 0) return "empty";
  const ratio = missing / stat.eligible;
  if (ratio >= 1) return "full";
  if (ratio >= 0.5) return "mid";
  return "low";
}
