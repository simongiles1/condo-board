export type FileCategory =
  | "meeting-minutes"
  | "board-package"
  | "financial-statements"
  | "financial-notes";

export type CategorizedFile = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  emailId: string;
  threadId: string | null;
  fromAddress: string;
  subject: string;
  receivedAt: string;
};

export type CategorizedFiles = Record<FileCategory, CategorizedFile[]>;

export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  "meeting-minutes": "Meeting minutes",
  "board-package": "Board packages",
  "financial-statements": "Financial statements",
  "financial-notes": "Financial notes",
};

export const FILE_CATEGORY_ORDER: FileCategory[] = [
  "meeting-minutes",
  "board-package",
  "financial-statements",
  "financial-notes",
];

const CONDO_NUMBER = "2517";

const MONTH_NAMES =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/** e.g. "July 30-2025.2517 TSCC.pdf" or "May 21-2025.2517 TSCC (3).pdf" */
const MEETING_MINUTES_PATTERN = new RegExp(
  `^(${MONTH_NAMES})\\s+\\d{1,2}-\\d{4}\\.${CONDO_NUMBER}\\s+TSCC(?:\\s*\\(\\d+\\))?\\.pdf$`,
  "i",
);

/** e.g. "2517 TSCC FS May 2025.pdf" or "2517 TSCC FS June 2025 (2).pdf" */
const FINANCIAL_STATEMENTS_PATTERN = new RegExp(
  `^${CONDO_NUMBER}\\s+TSCC\\s+FS\\s+(${MONTH_NAMES})\\s+\\d{4}(?:\\s*\\(\\d+\\))?\\.pdf$`,
  "i",
);

/** e.g. "TSCC 2517 Financial Notes July 2025.pdf" or "TSCC 2517 Financial Notes August 2025 (2).pdf" */
const FINANCIAL_NOTES_PATTERN = new RegExp(
  `^TSCC\\s+${CONDO_NUMBER}\\s+Financial Notes\\s+(${MONTH_NAMES})\\s+\\d{4}(?:\\s*\\(\\d+\\))?\\.pdf$`,
  "i",
);

const BOARD_PACKAGE_PREFIX_PATTERN = new RegExp(
  `^TSCC\\s+${CONDO_NUMBER}-\\s*board meeting package.*\\.pdf$`,
  "i",
);

const BOARD_PACKAGE_WITH_CONDO_PATTERN = new RegExp(
  `${CONDO_NUMBER}.*board meeting package|board meeting package.*${CONDO_NUMBER}`,
  "i",
);

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
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export function isMeetingMinutesFilename(filename: string): boolean {
  return MEETING_MINUTES_PATTERN.test(filename);
}

export function isBoardPackageFilename(filename: string): boolean {
  if (!/\.pdf$/i.test(filename)) return false;
  if (!/board meeting package/i.test(filename)) return false;

  const corpNumber = filename.match(/TSCC\s*(\d{4})/i);
  if (corpNumber && corpNumber[1] !== CONDO_NUMBER) return false;

  if (BOARD_PACKAGE_PREFIX_PATTERN.test(filename)) return true;
  if (/^board meeting package/i.test(filename)) return true;
  if (BOARD_PACKAGE_WITH_CONDO_PATTERN.test(filename)) return true;

  return false;
}

export function isFinancialStatementsFilename(filename: string): boolean {
  return FINANCIAL_STATEMENTS_PATTERN.test(filename);
}

/** Placeholder — patterns to be added later. */
export function isFinancialNotesFilename(filename: string): boolean {
  return FINANCIAL_NOTES_PATTERN.test(filename);
}

export function categorizeAttachment(filename: string): FileCategory | null {
  if (isMeetingMinutesFilename(filename)) return "meeting-minutes";
  if (isBoardPackageFilename(filename)) return "board-package";
  if (isFinancialStatementsFilename(filename)) return "financial-statements";
  if (isFinancialNotesFilename(filename)) return "financial-notes";
  return null;
}

/** Parse the meeting date from a meeting-minutes filename for sorting. */
export function parseMeetingMinutesDate(filename: string): Date | null {
  const match = filename.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})-(\d{4})/i,
  );
  if (!match) return null;

  const month = MONTH_INDEX[match[1].toLowerCase()];
  if (month == null) return null;

  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  const date = new Date(year, month, day);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

export function sortMeetingMinutesFiles(
  files: CategorizedFile[],
): CategorizedFile[] {
  return [...files].sort((a, b) => {
    const dateA = parseMeetingMinutesDate(a.filename);
    const dateB = parseMeetingMinutesDate(b.filename);

    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime();
    }
    if (dateA) return -1;
    if (dateB) return 1;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}

/** Best-effort parse of a board-package meeting date from varied filename suffixes. */
export function parseBoardPackageDate(filename: string): Date | null {
  const monthDayYear = filename.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})/i,
  );
  if (monthDayYear) {
    const month = MONTH_INDEX[monthDayYear[1].toLowerCase().replace(/\.$/, "")];
    if (month == null) return null;

    const day = Number.parseInt(monthDayYear[2], 10);
    const year = Number.parseInt(monthDayYear[3], 10);
    const date = new Date(year, month, day);
    if (Number.isNaN(date.getTime())) return null;

    return date;
  }

  const isoDate = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const year = Number.parseInt(isoDate[1], 10);
    const month = Number.parseInt(isoDate[2], 10) - 1;
    const day = Number.parseInt(isoDate[3], 10);
    const date = new Date(year, month, day);
    if (Number.isNaN(date.getTime())) return null;

    return date;
  }

  return null;
}

export function sortBoardPackageFiles(
  files: CategorizedFile[],
): CategorizedFile[] {
  return [...files].sort((a, b) => {
    const dateA = parseBoardPackageDate(a.filename);
    const dateB = parseBoardPackageDate(b.filename);

    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime();
    }
    if (dateA) return -1;
    if (dateB) return 1;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}

/** Parse the statement month from a financial-statements filename for sorting. */
export function parseFinancialStatementsDate(filename: string): Date | null {
  const match = filename.match(
    new RegExp(
      `^${CONDO_NUMBER}\\s+TSCC\\s+FS\\s+(${MONTH_NAMES})\\s+(\\d{4})`,
      "i",
    ),
  );
  if (!match) return null;

  const month = MONTH_INDEX[match[1].toLowerCase()];
  if (month == null) return null;

  const year = Number.parseInt(match[2], 10);
  const date = new Date(year, month, 1);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

export function sortFinancialStatementsFiles(
  files: CategorizedFile[],
): CategorizedFile[] {
  return [...files].sort((a, b) => {
    const dateA = parseFinancialStatementsDate(a.filename);
    const dateB = parseFinancialStatementsDate(b.filename);

    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime();
    }
    if (dateA) return -1;
    if (dateB) return 1;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}

/** Parse the notes month from a financial-notes filename for sorting. */
export function parseFinancialNotesDate(filename: string): Date | null {
  const match = filename.match(
    new RegExp(
      `^TSCC\\s+${CONDO_NUMBER}\\s+Financial Notes\\s+(${MONTH_NAMES})\\s+(\\d{4})`,
      "i",
    ),
  );
  if (!match) return null;

  const month = MONTH_INDEX[match[1].toLowerCase()];
  if (month == null) return null;

  const year = Number.parseInt(match[2], 10);
  const date = new Date(year, month, 1);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

export function sortFinancialNotesFiles(
  files: CategorizedFile[],
): CategorizedFile[] {
  return [...files].sort((a, b) => {
    const dateA = parseFinancialNotesDate(a.filename);
    const dateB = parseFinancialNotesDate(b.filename);

    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime();
    }
    if (dateA) return -1;
    if (dateB) return 1;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}

export function emptyCategorizedFiles(): CategorizedFiles {
  return {
    "meeting-minutes": [],
    "board-package": [],
    "financial-statements": [],
    "financial-notes": [],
  };
}

export function categorizeFiles(
  attachments: CategorizedFile[],
): CategorizedFiles {
  const result = emptyCategorizedFiles();

  for (const attachment of attachments) {
    const category = categorizeAttachment(attachment.filename);
    if (category) {
      result[category].push(attachment);
    }
  }

  result["meeting-minutes"] = sortMeetingMinutesFiles(
    result["meeting-minutes"],
  );
  result["board-package"] = sortBoardPackageFiles(result["board-package"]);
  result["financial-statements"] = sortFinancialStatementsFiles(
    result["financial-statements"],
  );
  result["financial-notes"] = sortFinancialNotesFiles(result["financial-notes"]);

  return result;
}
