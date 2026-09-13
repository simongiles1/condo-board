/**
 * Client-safe helpers for recurring document series.
 * Clustering and LLM JSON parsing live here so the worker and tests share them.
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

/** Cosine threshold for connecting two file-card embeddings into one cluster. */
export const DOCUMENT_SERIES_CLUSTER_THRESHOLD = 0.78;

const MONTH_DATE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}[.,]?\s+\d{4}\b/gi;
const ISO_DATE_RE = /\b(?:19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/g;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const COPY_SUFFIX_RE = /\(\s*\d+\s*\)/g;

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

export function buildSeriesIdentityText(params: {
  filename: string;
  documentType: string;
  documentDate: string | null;
  coveringEmailContext: string;
  summary: string;
}): string {
  const stem = stripTemporalTokens(params.filename.replace(/\.[^.]+$/, ""));
  const summary = params.summary.replace(/\s+/g, " ").trim().slice(0, 500);
  const covering = params.coveringEmailContext
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  return [
    `Role label: ${stem || params.filename}`,
    `Shape: ${params.documentType}`,
    params.documentDate ? `Instance date: ${params.documentDate}` : null,
    covering ? `Covering email: ${covering}` : null,
    summary ? `Summary: ${summary}` : null,
  ]
    .filter(Boolean)
    .join("\n");
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

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!];
      i = this.parent[i]!;
    }
    return i;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Connected components: join indexes whose cosine similarity is >= threshold.
 * Returns clusters sorted largest-first; singletons included.
 */
export function clusterByCosine(
  vectors: number[][],
  threshold = DOCUMENT_SERIES_CLUSTER_THRESHOLD,
): number[][] {
  const n = vectors.length;
  if (n === 0) return [];
  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    const left = vectors[i];
    if (!left) continue;
    for (let j = i + 1; j < n; j++) {
      const right = vectors[j];
      if (!right) continue;
      if (cosineSimilarity(left, right) >= threshold) {
        uf.union(i, j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

export type SeriesNameProposal = {
  title: string;
  description: string;
  clusterIds: number[];
  existingId: string | null;
  drop: boolean;
  usage: DocumentSeriesUsage | null;
};

export const DOCUMENT_SERIES_NAME_SYSTEM_PROMPT = `You name recurring condominium document series from clustered file cards.

Each cluster is a candidate repeating document role (same kind of file, different dates). ICC may rename a series over the years.

Return JSON only:
{
  "series": [
    {
      "title": "short human title",
      "description": "one sentence describing the repeating document",
      "clusterIds": [0],
      "existingId": "optional-id-or-null",
      "drop": false,
      "usage": "board_package" | "minutes" | "financial_statements" | "financial_notes" | "other" | null
    }
  ]
}

Rules:
- Merge clusters that are the same document role even when filenames differ. A standalone Management Report that is the circulated pre-meeting packet belongs with Board meeting packages — one series, not two.
- drop: true when the cluster is not recurring (one-off quote, unique letter, mixed junk).
- Do not invent one series per meeting date. Dated instances belong in one series.
- File content wins over covering email and filename when they disagree about what THIS file is. Sibling attachments in a "board package" email are not all the packet — ledgers and financial statements are their own series.
- usage is a consumer binding for app features, not the catalog of types. The catalog is the titles you invent.
  board_package = the pre-meeting packet the board reviews.
  minutes = official meeting minutes PDFs.
  financial_statements / financial_notes = the repeating monthly financial pack.
  other or null = everything else.
- If an existing series is the same role, set existingId to that id and keep its title unless it is clearly wrong.
- Every non-dropped cluster id appears in exactly one series.`;

export function parseSeriesNameProposals(
  raw: unknown,
  knownClusterIds: ReadonlySet<number>,
  existingIds: ReadonlySet<string>,
): SeriesNameProposal[] {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(obj?.series)
    ? obj.series
    : Array.isArray(raw)
      ? raw
      : [];
  const seenClusters = new Set<number>();
  const proposals: SeriesNameProposal[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : "Untitled series";
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const drop = record.drop === true;
    const existingRaw =
      typeof record.existingId === "string"
        ? record.existingId.trim()
        : typeof record.existing_id === "string"
          ? record.existing_id.trim()
          : "";
    const existingId =
      existingRaw && existingIds.has(existingRaw) ? existingRaw : null;
    const clusterIds: number[] = [];
    const rawIds = record.clusterIds ?? record.cluster_ids;
    const idList = Array.isArray(rawIds) ? rawIds : [];
    for (const id of idList) {
      const n = typeof id === "number" ? id : Number.parseInt(String(id), 10);
      if (!Number.isInteger(n) || !knownClusterIds.has(n) || seenClusters.has(n)) {
        continue;
      }
      seenClusters.add(n);
      clusterIds.push(n);
    }
    if (clusterIds.length === 0 && !existingId) continue;
    proposals.push({
      title,
      description,
      clusterIds,
      existingId,
      drop,
      usage: parseDocumentSeriesUsage(record.usage),
    });
  }

  return proposals;
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
