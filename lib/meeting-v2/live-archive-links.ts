import {
  parseFinancialStatementsDate,
  parseMeetingMinutesDate,
} from "@/lib/email/file-categories";

export type AgendaArchiveKind = "meeting-minutes" | "financial-statements";

export type ArchiveFileRef = {
  id: string;
  filename: string;
  receivedAt: string;
};

export type LiveArchiveLink = {
  agendaItemId: string;
  kind: AgendaArchiveKind;
  fileId: string;
  filename: string;
  label: string;
};

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

export type AgendaTitleDate = {
  year: number;
  month: number;
  day: number | null;
};

/**
 * Minutes or financial-statement review, from the agenda title.
 * Returns null for every other item.
 */
export function agendaArchiveKind(title: string): AgendaArchiveKind | null {
  if (/\bminutes\b/i.test(title)) return "meeting-minutes";
  if (/financial\s+statements/i.test(title)) return "financial-statements";
  return null;
}

/**
 * Month, day, and year named in an agenda title.
 * A month and year with no day is a statement period, not a meeting date.
 */
export function parseAgendaTitleDate(title: string): AgendaTitleDate | null {
  const withDay = title.match(new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"));
  if (withDay) {
    const month = MONTH_INDEX[withDay[1].toLowerCase()];
    const day = Number(withDay[2]);
    const year = Number(withDay[3]);
    if (month == null || day < 1 || day > 31) return null;
    return { year, month, day };
  }
  const monthOnly = title.match(new RegExp(`\\b(${MONTHS})\\s+(\\d{4})\\b`, "i"));
  if (!monthOnly) return null;
  const month = MONTH_INDEX[monthOnly[1].toLowerCase()];
  if (month == null) return null;
  return { year: Number(monthOnly[2]), month, day: null };
}

function monthName(month: number): string {
  return MONTHS.split("|")[month] ?? "";
}

function archiveLabel(kind: AgendaArchiveKind, date: AgendaTitleDate): string {
  if (kind === "financial-statements") {
    return `${monthName(date.month)} ${date.year} financial statements`;
  }
  if (date.day != null) {
    return `${monthName(date.month)} ${date.day}, ${date.year} minutes`;
  }
  return `${monthName(date.month)} ${date.year} minutes`;
}

function fileDate(kind: AgendaArchiveKind, filename: string): Date | null {
  return kind === "meeting-minutes"
    ? parseMeetingMinutesDate(filename)
    : parseFinancialStatementsDate(filename);
}

function samePeriod(kind: AgendaArchiveKind, file: Date, wanted: AgendaTitleDate): boolean {
  if (file.getFullYear() !== wanted.year || file.getMonth() !== wanted.month) return false;
  if (kind === "financial-statements" || wanted.day == null) return true;
  return file.getDate() === wanted.day;
}

/**
 * The categorized file named by an agenda title.
 * A minutes title with a day matches that meeting. A financial-statement title matches that month.
 * Returns null when the title is a different kind of item, or no file has that date.
 */
export function matchAgendaArchiveFile(
  title: string,
  files: ArchiveFileRef[],
): Omit<LiveArchiveLink, "agendaItemId"> | null {
  const kind = agendaArchiveKind(title);
  const wanted = parseAgendaTitleDate(title);
  if (!kind || !wanted) return null;

  const matches = files
    .map((file) => ({ file, date: fileDate(kind, file.filename) }))
    .filter((row): row is { file: ArchiveFileRef; date: Date } => row.date != null && samePeriod(kind, row.date, wanted))
    .sort((left, right) => {
      const leftCopy = /\(\d+\)\.pdf$/i.test(left.file.filename) ? 1 : 0;
      const rightCopy = /\(\d+\)\.pdf$/i.test(right.file.filename) ? 1 : 0;
      if (leftCopy !== rightCopy) return leftCopy - rightCopy;
      return right.file.receivedAt.localeCompare(left.file.receivedAt);
    });

  const best = matches[0]?.file;
  if (!best) return null;
  return {
    kind,
    fileId: best.id,
    filename: best.filename,
    label: archiveLabel(kind, wanted),
  };
}

/**
 * One archive link per agenda item whose title names a minutes or statement file on hand.
 */
export function archiveLinksForLeaves(
  leaves: Array<{ id: string; title: string }>,
  files: { minutes: ArchiveFileRef[]; financials: ArchiveFileRef[] },
): LiveArchiveLink[] {
  const links: LiveArchiveLink[] = [];
  for (const leaf of leaves) {
    const kind = agendaArchiveKind(leaf.title);
    if (!kind) continue;
    const match = matchAgendaArchiveFile(
      leaf.title,
      kind === "meeting-minutes" ? files.minutes : files.financials,
    );
    if (!match) continue;
    links.push({ agendaItemId: leaf.id, ...match });
  }
  return links;
}
