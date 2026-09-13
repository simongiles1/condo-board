/**
 * Client-safe helpers for recurring document series.
 * Catalog/assignment JSON parsing lives here so the worker and tests share them.
 */

export const DOCUMENT_SERIES_USAGES = [
  "board_package",
  "minutes",
  "financial_statements",
  "financial_notes",
  "other",
] as const;

export type DocumentSeriesUsage = (typeof DOCUMENT_SERIES_USAGES)[number];

export const DOCUMENT_SERIES_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type DocumentSeriesRunStatus =
  (typeof DOCUMENT_SERIES_RUN_STATUSES)[number];

export const DOCUMENT_SERIES_MEMBER_SOURCES = ["discovery", "human"] as const;
export type DocumentSeriesMemberSource =
  (typeof DOCUMENT_SERIES_MEMBER_SOURCES)[number];

export const DOCUMENT_SERIES_CATALOG_SAMPLE_SIZE = 80;
export const DOCUMENT_SERIES_ASSIGN_BATCH_SIZE = 40;

const MONTH_DATE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}[.,]?\s+\d{4}\b/gi;
const ISO_DATE_RE = /\b(?:19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/g;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const COPY_SUFFIX_RE = /\(\s*\d+\s*\)/g;
const DECORATIVE_IMAGE_NAME_RE =
  /^(image(\d{0,4})?|logo|signature|img[-_]?\d*)\.(png|jpe?g|gif|webp|bmp)$/i;
const SCREENSHOT_NAME_RE = /^screenshot\b/i;

export function parseDocumentSeriesUsage(
  value: unknown,
): DocumentSeriesUsage | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (trimmed === "board_meeting_package") return "board_package";
  if (trimmed === "meeting_minutes") return "minutes";
  return DOCUMENT_SERIES_USAGES.includes(trimmed as DocumentSeriesUsage)
    ? (trimmed as DocumentSeriesUsage)
    : null;
}

/** Strip dates and copy suffixes so dated instances of the same role look alike. */
export function stripTemporalTokens(value: string): string {
  return value
    .replace(MONTH_DATE_RE, " ")
    .replace(ISO_DATE_RE, " ")
    .replace(YEAR_RE, " ")
    .replace(COPY_SUFFIX_RE, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function seriesKeyFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

export function isDecorativeSeriesFilename(filename: string): boolean {
  const base = filename.trim().split(/[/\\]/).pop() ?? filename;
  return DECORATIVE_IMAGE_NAME_RE.test(base) || SCREENSHOT_NAME_RE.test(base);
}

/** Skip logos, screenshots, and explicitly valueless attachments from series discovery. */
export function isSeriesDiscoveryEligible(params: {
  mimeType: string;
  filename: string;
  hasValue: boolean | null;
}): boolean {
  if (params.hasValue === false) return false;
  const mime = params.mimeType.trim().toLowerCase();
  if (mime.startsWith("image/")) return false;
  if (isDecorativeSeriesFilename(params.filename)) return false;
  return true;
}

function uniqueDayCount(dates: Array<string | null>): number {
  const days = new Set<string>();
  for (const value of dates) {
    const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) days.add(match[1]!);
  }
  return days.size;
}

/** Recurring = the same role on at least two distinct calendar days. */
export function clusterLooksRecurring(dates: Array<string | null>): boolean {
  return uniqueDayCount(dates) >= 2;
}

/**
 * Round-robin across document-type + date-stripped filename buckets so the
 * catalog sample is not the most recent 80 files of one shape.
 */
export function sampleSeriesDiscoveryDocs<
  T extends { documentType: string; filename: string },
>(docs: T[], limit = DOCUMENT_SERIES_CATALOG_SAMPLE_SIZE): T[] {
  if (docs.length <= limit) return [...docs];
  const buckets = new Map<string, T[]>();
  for (const doc of docs) {
    const stem =
      stripTemporalTokens(doc.filename.replace(/\.[^.]+$/, "")) || doc.filename;
    const key = `${doc.documentType}::${stem.slice(0, 48).toLowerCase()}`;
    const list = buckets.get(key);
    if (list) list.push(doc);
    else buckets.set(key, [doc]);
  }
  const bucketLists = [...buckets.values()].sort((a, b) => b.length - a.length);
  const sampled: T[] = [];
  let round = 0;
  while (sampled.length < limit) {
    let added = false;
    for (const list of bucketLists) {
      if (sampled.length >= limit) break;
      const item = list[round];
      if (item) {
        sampled.push(item);
        added = true;
      }
    }
    if (!added) break;
    round += 1;
  }
  return sampled;
}

export type SeriesCatalogEntry = {
  key: string;
  title: string;
  description: string;
  usage: DocumentSeriesUsage | null;
  existingId: string | null;
};

export const DOCUMENT_SERIES_CATALOG_SYSTEM_PROMPT = `You propose a catalog of recurring condominium document types from a diverse sample of file cards.

A recurring type is the same document role issued on more than one date (monthly financials, board packets, resident notices, minutes). One-off quotes, unique letters, screenshots, and mixed junk are not types.

Return JSON only:
{
  "series": [
    {
      "key": "board-meeting-packages",
      "title": "short human title",
      "description": "one sentence describing the repeating document",
      "existingId": "optional-id-or-null",
      "usage": "board_package" | "minutes" | "financial_statements" | "financial_notes" | "other" | null
    }
  ]
}

Rules:
- Only propose a type when the sample shows (or clearly implies) more than one dated instance of that role.
- Do not invent a catch-all such as Miscellaneous, Other documents, or Engineering Assessment Reports for mixed files.
- Merge filename variants of the same role. A standalone Management Report that is the circulated pre-meeting packet belongs with Board meeting packages — one type.
- File content wins over covering email and filename when they disagree. Sibling attachments in a "board package" email are not all the packet — ledgers and financial statements are their own types.
- usage is a consumer binding, not the catalog:
  board_package = the pre-meeting packet the board reviews.
  minutes = official meeting minutes PDFs.
  financial_statements / financial_notes = the repeating monthly financial pack.
  other or null = everything else that still repeats.
- If an existing series is the same role, set existingId to that id and keep its title unless it is clearly wrong.
- key is a short kebab-case id. Reuse an existing series' implied key when existingId is set.`;

export const DOCUMENT_SERIES_ASSIGN_SYSTEM_PROMPT = `You assign condominium file cards to recurring document types, or mark them as not recurring.

Return JSON only:
{
  "assignments": [
    { "id": 0, "seriesKey": "board-meeting-packages", "newTitle": null }
  ]
}

Rules:
- seriesKey must be a catalog key, or null when the file is not a repeating type (one-off quote, unique letter, image leftover, mixed junk).
- newTitle: set only when the file is clearly a repeating role missing from the catalog. Then seriesKey may be a new kebab-case key. Do not invent a catch-all type.
- Dated instances of the same role share one seriesKey. Do not invent one type per meeting date.
- File content (summary + document type) wins over covering email and filename when they disagree.
- A Management Report that is the circulated pre-meeting packet uses the board-package type when that key exists.
- Every id in the batch appears exactly once.`;

export function parseSeriesCatalog(
  raw: unknown,
  existingIds: ReadonlySet<string>,
): SeriesCatalogEntry[] {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(obj?.series)
    ? obj.series
    : Array.isArray(raw)
      ? raw
      : [];
  const seen = new Set<string>();
  const entries: SeriesCatalogEntry[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : "";
    if (!title) continue;
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const existingRaw =
      typeof record.existingId === "string"
        ? record.existingId.trim()
        : typeof record.existing_id === "string"
          ? record.existing_id.trim()
          : "";
    const existingId =
      existingRaw && existingIds.has(existingRaw) ? existingRaw : null;
    const keySource =
      typeof record.key === "string" && record.key.trim()
        ? record.key
        : title;
    let key = seriesKeyFromTitle(keySource);
    if (seen.has(key)) {
      let n = 2;
      while (seen.has(`${key}-${n}`)) n += 1;
      key = `${key}-${n}`;
    }
    seen.add(key);
    entries.push({
      key,
      title,
      description,
      existingId,
      usage: parseDocumentSeriesUsage(record.usage),
    });
  }
  return entries;
}

export type SeriesAssignment = {
  index: number;
  seriesKey: string | null;
  newTitle: string | null;
};

export function parseSeriesAssignments(
  raw: unknown,
  knownIndexes: ReadonlySet<number>,
): SeriesAssignment[] {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(obj?.assignments)
    ? obj.assignments
    : Array.isArray(raw)
      ? raw
      : [];
  const seen = new Set<number>();
  const assignments: SeriesAssignment[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const idRaw = record.id ?? record.index;
    const index =
      typeof idRaw === "number" ? idRaw : Number.parseInt(String(idRaw), 10);
    if (!Number.isInteger(index) || !knownIndexes.has(index) || seen.has(index)) {
      continue;
    }
    seen.add(index);
    const newTitle =
      typeof record.newTitle === "string" && record.newTitle.trim()
        ? record.newTitle.trim()
        : typeof record.new_title === "string" && record.new_title.trim()
          ? record.new_title.trim()
          : null;
    const keyRaw =
      typeof record.seriesKey === "string"
        ? record.seriesKey.trim()
        : typeof record.series_key === "string"
          ? record.series_key.trim()
          : "";
    const seriesKey = keyRaw ? seriesKeyFromTitle(keyRaw) : newTitle
      ? seriesKeyFromTitle(newTitle)
      : null;
    assignments.push({
      index,
      seriesKey,
      newTitle,
    });
  }
  return assignments;
}

export function parseJsonObjectText(text: string): unknown {
  const stripped = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Model response was not valid JSON.");
    }
    return JSON.parse(stripped.slice(start, end + 1)) as unknown;
  }
}
