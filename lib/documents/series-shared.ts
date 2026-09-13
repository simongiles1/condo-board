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
export const DOCUMENT_SERIES_VERIFY_BATCH_SIZE = 25;

const MONTH_DATE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}[.,]?\s+\d{4}\b/gi;
const ISO_DATE_RE = /\b(?:19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/g;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const COPY_SUFFIX_RE = /\(\s*\d+\s*\)/g;
const WEEKDAY_RE =
  /\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;
const EXTENSION_RE = /\.[a-z0-9]{1,5}$/i;
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

/** Filename with dates, weekdays, and copy suffixes removed — one key per repeating instance. */
export function seriesInstanceKey(filename: string): string {
  const base = filename.trim().split(/[/\\]/).pop() ?? filename;
  const withoutExt = base.replace(EXTENSION_RE, "");
  const stem = stripTemporalTokens(withoutExt)
    .replace(WEEKDAY_RE, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return stem || "untitled";
}

export function titleFromInstanceKey(key: string): string {
  const words = key
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "Untitled";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function groupByInstanceKey<T extends { filename: string }>(
  docs: T[],
): Array<{ instanceKey: string; docs: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const doc of docs) {
    const key = seriesInstanceKey(doc.filename);
    const list = buckets.get(key);
    if (list) list.push(doc);
    else buckets.set(key, [doc]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([instanceKey, groupDocs]) => ({ instanceKey, docs: groupDocs }));
}

export type RecurringSubtypeMember = {
  contentHash: string;
  receivedAt: string;
  subtypeKey: string;
  subtypeTitle: string;
};

/** Drop subtype groups that do not have instances on at least two calendar days. */
export function keepRecurringSubtypeMembers(
  members: RecurringSubtypeMember[],
): RecurringSubtypeMember[] {
  const byKey = new Map<string, RecurringSubtypeMember[]>();
  for (const member of members) {
    const list = byKey.get(member.subtypeKey);
    if (list) list.push(member);
    else byKey.set(member.subtypeKey, [member]);
  }
  const kept: RecurringSubtypeMember[] = [];
  for (const list of byKey.values()) {
    if (clusterLooksRecurring(list.map((row) => row.receivedAt))) {
      kept.push(...list);
    }
  }
  return kept;
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

A recurring type is a document role the archive issues on more than one date (monthly financials, board packets, resident notices, minutes). Broad parents such as Resident Notices are allowed when many notices exist; a later pass splits them into repeating subtypes and drops one-offs. Unique quotes, incident letters, and mixed junk are not types.

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
- seriesKey must be a catalog key, or null when the file is obviously not a repeating type (one-off quote, unique incident letter, image leftover, mixed junk).
- Assignment to a broad type (Resident Notices) is a candidate. Prefer null for a unique event notice (temporary amenity closure, a one-time guidelines PDF) even if it is a letter to residents.
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

export const DOCUMENT_SERIES_VERIFY_SYSTEM_PROMPT = `You verify whether candidate filename stems are dated instances of a repeating document, not one-off notices.

A recurring subtype is the SAME document issued on more than one date (management office-hours notices, repeated hot-water interruption notices, weekly reports). A unique event (temporary hot-tub closure until a safety issue is fixed, a one-time balcony guidelines PDF, a single incident letter) is not recurring even when it is a letter to residents.

Return JSON only:
{
  "assignments": [
    { "id": 0, "subtypeKey": "office-hours", "subtypeTitle": "Management office hours" }
  ]
}

Rules:
- Existing catalog keys are repeating subtypes already confirmed by multiple dates. Merge a stem into one of those when it is the same document with a slightly different filename.
- subtypeKey is an existing catalog key, a new kebab-case key only when several stems in this batch are clearly the same repeating document, or null when the stem is a one-off.
- subtypeTitle is required when subtypeKey is set. Reuse the catalog title when you reuse a key.
- Do not dump leftovers into Other notices, Miscellaneous, or a topic bucket (all hot-tub letters). Same topic is not the same repeating document.
- Filename dates do not make a unique event recurring.
- Every id in the batch appears exactly once.`;

export type SeriesSubtypeAssignment = {
  index: number;
  subtypeKey: string | null;
  subtypeTitle: string | null;
};

export function parseSeriesSubtypeAssignments(
  raw: unknown,
  knownIndexes: ReadonlySet<number>,
): SeriesSubtypeAssignment[] {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(obj?.assignments)
    ? obj.assignments
    : Array.isArray(raw)
      ? raw
      : [];
  const seen = new Set<number>();
  const assignments: SeriesSubtypeAssignment[] = [];

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
    const subtypeTitle =
      typeof record.subtypeTitle === "string" && record.subtypeTitle.trim()
        ? record.subtypeTitle.trim()
        : typeof record.subtype_title === "string" && record.subtype_title.trim()
          ? record.subtype_title.trim()
          : null;
    const keyRaw =
      typeof record.subtypeKey === "string"
        ? record.subtypeKey.trim()
        : typeof record.subtype_key === "string"
          ? record.subtype_key.trim()
          : "";
    const subtypeKey = keyRaw
      ? seriesKeyFromTitle(keyRaw)
      : subtypeTitle
        ? seriesKeyFromTitle(subtypeTitle)
        : null;
    assignments.push({
      index,
      subtypeKey,
      subtypeTitle,
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
