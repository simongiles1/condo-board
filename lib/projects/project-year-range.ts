/** Canonical project year or inclusive year range (identity + badges). */

export type ProjectYearRange = {
  start: number;
  end: number;
};

const YEAR_RE = /(?:19|20)\d{2}/;
const YEAR_RE_GLOBAL = /(?:19|20)\d{2}/g;
const RANGE_SEP = "–";

function isCalendarYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2100;
}

function range(start: number, end: number): ProjectYearRange | null {
  if (!isCalendarYear(start) || !isCalendarYear(end)) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

function referenceYear(referenceDate: Date): number {
  return referenceDate.getFullYear();
}

function isDurationOnly(key: string, years: number[]): boolean {
  if (years.length > 0) return false;
  return (
    /\b\d+\s*-?\s*years?\b/.test(key) ||
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*-?\s*years?\b/.test(
      key,
    )
  );
}

function isSeasonOnly(key: string, years: number[]): boolean {
  if (years.length > 0) return false;
  return /\b(spring|summer|fall|autumn|winter)\b/.test(key);
}

function parseTwoDigitYear(start: number, yy: number): number {
  const candidate = Math.floor(start / 100) * 100 + yy;
  return candidate >= start ? candidate : candidate + 100;
}

function parseRelativeRange(
  key: string,
  referenceDate: Date,
): ProjectYearRange | null {
  const year = referenceYear(referenceDate);
  if (/\bthis year\b/.test(key) || /\bthis coming year\b/.test(key)) {
    return range(year, year);
  }
  if (/\bnext year\b/.test(key)) return range(year + 1, year + 1);
  if (/\blast year\b/.test(key)) return range(year - 1, year - 1);
  return null;
}

function parseCompactRange(text: string): ProjectYearRange | null {
  const compact = text.match(
    /\b((?:19|20)\d{2})\s*[-/–—]\s*((?:19|20)\d{2}|\d{2})\b/,
  );
  if (!compact) return null;
  const start = Number(compact[1]);
  const rawEnd = compact[2] ?? "";
  const end =
    rawEnd.length === 2 ? parseTwoDigitYear(start, Number(rawEnd)) : Number(rawEnd);
  return range(start, end);
}

/** Parse a hint into an inclusive calendar-year range. Durations/seasons drop. */
export function parseProjectYearRange(
  raw: string | null | undefined,
  referenceDate: Date = new Date(),
): ProjectYearRange | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  const key = trimmed.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  const years = [...trimmed.matchAll(YEAR_RE_GLOBAL)].map((match) =>
    Number(match[0]),
  );

  if (isDurationOnly(key, years) || isSeasonOnly(key, years)) return null;

  const relative = parseRelativeRange(key, referenceDate);
  if (relative) return relative;

  const compact = parseCompactRange(trimmed);
  if (compact) return compact;

  const fy = trimmed.match(/\b(?:fy|fiscal(?:\s+year)?)\s*((?:19|20)\d{2})\b/i);
  if (fy) {
    const year = Number(fy[1]);
    return range(year, year);
  }

  if (years.length === 1) return range(years[0]!, years[0]!);
  if (years.length > 1) {
    return range(Math.min(...years), Math.max(...years));
  }

  if (!YEAR_RE.test(trimmed)) return null;
  return null;
}

export function formatProjectYearRange(value: ProjectYearRange): string {
  if (value.start === value.end) return String(value.start);
  return `${value.start}${RANGE_SEP}${value.end}`;
}

/** ASCII identity token: "2024" or "2024-2026". */
export function projectYearRangeIdentity(value: ProjectYearRange): string {
  if (value.start === value.end) return String(value.start);
  return `${value.start}-${value.end}`;
}

export function projectYearRangeStart(
  raw: string | null | undefined,
  referenceDate?: Date,
): number | null {
  return parseProjectYearRange(raw, referenceDate)?.start ?? null;
}

export function projectYearRangeCovers(
  raw: string | null | undefined,
  year: number,
  referenceDate?: Date,
): boolean {
  const parsed = parseProjectYearRange(raw, referenceDate);
  if (!parsed) return false;
  return year >= parsed.start && year <= parsed.end;
}

export function projectYearRangesOverlap(
  left: ProjectYearRange,
  right: ProjectYearRange,
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

export function unionProjectYearRanges(
  left: ProjectYearRange,
  right: ProjectYearRange,
): ProjectYearRange {
  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
}

/**
 * Canonical display/storage value: "2024" or "2024–2026".
 * Relatives resolve against `referenceDate` (defaults to now).
 */
export function normalizeProjectYearHint(
  yearHint: string | null | undefined,
  referenceDate: Date = new Date(),
): string | null {
  const parsed = parseProjectYearRange(yearHint, referenceDate);
  return parsed ? formatProjectYearRange(parsed) : null;
}

export function preferProjectYearHint(
  a: string | null | undefined,
  b: string | null | undefined,
  referenceDate: Date = new Date(),
): string | null {
  const left = parseProjectYearRange(a, referenceDate);
  const right = parseProjectYearRange(b, referenceDate);
  if (!left) return right ? formatProjectYearRange(right) : null;
  if (!right) return formatProjectYearRange(left);
  return formatProjectYearRange(unionProjectYearRanges(left, right));
}

export function yearsMatch(
  left: string | null | undefined,
  right: string,
  referenceDate?: Date,
): boolean {
  const trimmed = right.trim();
  if (!trimmed) return false;
  const leftRange = parseProjectYearRange(left, referenceDate);
  const rightRange = parseProjectYearRange(trimmed, referenceDate);
  if (leftRange && rightRange) {
    return projectYearRangesOverlap(leftRange, rightRange);
  }
  const leftNorm = normalizeProjectYearHint(left, referenceDate);
  const rightNorm = normalizeProjectYearHint(trimmed, referenceDate);
  if (leftNorm && rightNorm) return leftNorm === rightNorm;
  return (left ?? "").trim().toLowerCase() === trimmed.toLowerCase();
}
