/**
 * Plan extraction backfill runs: Docling text pages and/or Gemini vision pages.
 */

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { attachmentDocumentPages } from "@/lib/db/schema";
import { resolveCachedPdfAbsolutePath } from "@/lib/dev/golden-attachments";
import {
  listDoclingBackfillDocs,
  type DoclingBackfillDoc,
} from "@/lib/email/docling-lab";
import {
  classifyVisionError,
  GEMINI_HTTP_ERROR_KINDS,
  type VisionErrorKind,
} from "@/lib/email/page-vision-shared";

export type ExtractionBackfillMode =
  | "docling_only"
  | "vision_only"
  | "full";

export type ExtractionBackfillPlanDoc = {
  contentHash: string;
  hasPdf: boolean;
  doclingPages: number[];
  visionPages: number[];
};

export type ExtractionBackfillPlan = {
  mode: ExtractionBackfillMode;
  docs: ExtractionBackfillPlanDoc[];
  totalDoclingPages: number;
  totalVisionPages: number;
  totalPages: number;
  corpusUncachedDoclingPages: number;
  corpusPendingDoclingDocs: number;
  corpusPendingVisionPages: number;
  corpusPendingVisionDocs: number;
  missingPdfDocs: number;
};

export type ExtractionBackfillPageError = {
  contentHash: string;
  pageNo: number;
  status: "failed" | "pending" | "processing";
  attempts: number;
  message: string;
};

export type ExtractionErrorGroup = {
  source: "vision";
  kind: VisionErrorKind;
  label: string;
  pages: number;
  docs: number;
  samples: Array<{ contentHash: string; pageNo: number; message: string }>;
};

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

export function groupVisionErrors(
  errors: ExtractionBackfillPageError[],
): ExtractionErrorGroup[] {
  const surfaced = errors.filter((item) => {
    if (item.status === "failed") return true;
    const { kind } = classifyVisionError(item.message);
    return (GEMINI_HTTP_ERROR_KINDS as string[]).includes(kind);
  });
  const byKind = new Map<
    VisionErrorKind,
    {
      label: string;
      pages: number;
      docs: Set<string>;
      samples: ExtractionErrorGroup["samples"];
    }
  >();
  for (const item of surfaced) {
    const { kind, label } = classifyVisionError(item.message);
    const cur = byKind.get(kind) ?? {
      label,
      pages: 0,
      docs: new Set<string>(),
      samples: [],
    };
    cur.pages += 1;
    cur.docs.add(item.contentHash);
    if (cur.samples.length < 3) {
      cur.samples.push({
        contentHash: item.contentHash,
        pageNo: item.pageNo,
        message: item.message,
      });
    }
    byKind.set(kind, cur);
  }
  return [...byKind.entries()]
    .map(([kind, cur]) => ({
      source: "vision" as const,
      kind,
      label: cur.label,
      pages: cur.pages,
      docs: cur.docs.size,
      samples: cur.samples,
    }))
    .sort((a, b) => b.pages - a.pages || a.kind.localeCompare(b.kind));
}

/** Compact last-error line: counts by kind, not every page hash. */
export function formatVisionErrorSummary(
  errors: ExtractionBackfillPageError[],
): string | null {
  return formatErrorGroupSummary(groupVisionErrors(errors));
}

export function formatErrorGroupSummary(
  groups: ExtractionErrorGroup[],
): string | null {
  if (groups.length === 0) return null;
  const total = groups.reduce((n, group) => n + group.pages, 0);
  const parts = groups.map((group) => {
    const sample =
      group.pages <= 3
        ? ` (${group.samples
            .map((item) => `${shortHash(item.contentHash)} p${item.pageNo}`)
            .join(", ")})`
        : "";
    return `${group.pages} ${group.label}${sample}`;
  });
  return `${total} vision page${total === 1 ? "" : "s"} failed · ${parts.join(" · ")}`;
}

const HASH_RE = /^[a-f0-9]{64}$/i;

function remainingWorkPages(doc: ExtractionBackfillPlanDoc): number {
  return doc.doclingPages.length + doc.visionPages.length;
}

/**
 * Pick up to `limit` docs so limited runs track corpus average size —
 * not the fattest N. Splits by remaining-page tertiles, takes a proportional
 * quota from each, evenly spaced within the bucket (hash-stable).
 */
export function selectRepresentativeDocs(
  candidates: ExtractionBackfillPlanDoc[],
  limit: number,
): ExtractionBackfillPlanDoc[] {
  if (limit <= 0 || candidates.length === 0) return [];
  if (limit >= candidates.length) {
    return [...candidates].sort((a, b) =>
      a.contentHash.localeCompare(b.contentHash),
    );
  }

  const byWork = [...candidates].sort((a, b) => {
    const wa = remainingWorkPages(a);
    const wb = remainingWorkPages(b);
    if (wa !== wb) return wa - wb;
    return a.contentHash.localeCompare(b.contentHash);
  });

  const bucketCount = Math.min(3, byWork.length);
  const buckets: ExtractionBackfillPlanDoc[][] = Array.from(
    { length: bucketCount },
    () => [],
  );
  for (let i = 0; i < byWork.length; i++) {
    const bucketIdx = Math.min(
      bucketCount - 1,
      Math.floor((i * bucketCount) / byWork.length),
    );
    buckets[bucketIdx]!.push(byWork[i]!);
  }

  const selected: ExtractionBackfillPlanDoc[] = [];
  const selectedHashes = new Set<string>();

  for (let bi = 0; bi < buckets.length; bi++) {
    const bucket = buckets[bi]!;
    const quota =
      Math.floor(limit / bucketCount) + (bi < limit % bucketCount ? 1 : 0);
    const n = Math.min(quota, bucket.length);
    if (n <= 0) continue;

    if (n >= bucket.length) {
      for (const doc of bucket) {
        selected.push(doc);
        selectedHashes.add(doc.contentHash);
      }
      continue;
    }

    // Evenly spaced across the bucket so we don't cluster on one edge.
    for (let j = 0; j < n; j++) {
      const idx = Math.min(
        bucket.length - 1,
        Math.floor(((j + 0.5) * bucket.length) / n),
      );
      const doc = bucket[idx]!;
      if (selectedHashes.has(doc.contentHash)) continue;
      selected.push(doc);
      selectedHashes.add(doc.contentHash);
    }
  }

  // Fill shortfalls (sparse buckets / hash collisions on spaced picks).
  if (selected.length < limit) {
    for (const doc of byWork) {
      if (selected.length >= limit) break;
      if (selectedHashes.has(doc.contentHash)) continue;
      selected.push(doc);
      selectedHashes.add(doc.contentHash);
    }
  }

  return selected
    .slice(0, limit)
    .sort((a, b) => a.contentHash.localeCompare(b.contentHash));
}

export function isExtractionBackfillMode(
  value: unknown,
): value is ExtractionBackfillMode {
  return (
    value === "docling_only" ||
    value === "vision_only" ||
    value === "full"
  );
}

/** Failed / still-retrying vision pages for the given hashes. */
export async function listVisionErrorsForHashes(
  hashes: string[],
): Promise<ExtractionBackfillPageError[]> {
  const unique = [
    ...new Set(
      hashes
        .map((hash) => hash.trim().toLowerCase())
        .filter((hash) => HASH_RE.test(hash)),
    ),
  ];
  if (unique.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select({
      contentHash: attachmentDocumentPages.contentHash,
      pageNo: attachmentDocumentPages.pageNo,
      status: attachmentDocumentPages.visionStatus,
      attempts: attachmentDocumentPages.visionAttempts,
      message: attachmentDocumentPages.visionError,
    })
    .from(attachmentDocumentPages)
    .where(
      and(
        inArray(attachmentDocumentPages.contentHash, unique),
        inArray(attachmentDocumentPages.visionStatus, [
          "failed",
          "pending",
          "processing",
        ]),
        isNotNull(attachmentDocumentPages.visionError),
        sql`length(trim(${attachmentDocumentPages.visionError})) > 0`,
      ),
    )
    .orderBy(
      attachmentDocumentPages.contentHash,
      attachmentDocumentPages.pageNo,
    );

  const out: ExtractionBackfillPageError[] = [];
  for (const row of rows) {
    const status = row.status;
    if (
      status !== "failed" &&
      status !== "pending" &&
      status !== "processing"
    ) {
      continue;
    }
    const message = row.message?.trim() ?? "";
    if (!message) continue;
    out.push({
      contentHash: row.contentHash.toLowerCase(),
      pageNo: row.pageNo,
      status,
      attempts: row.attempts || 0,
      message,
    });
  }
  return out;
}

/** Corpus-wide vision error counts keyed by hash — failed, plus pending billing/429. */
export async function loadFailedVisionCountsByHash(): Promise<
  Array<{
    contentHash: string;
    message: string;
    pages: number;
    status: string;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      contentHash: attachmentDocumentPages.contentHash,
      message: attachmentDocumentPages.visionError,
      status: attachmentDocumentPages.visionStatus,
      pages: sql<number>`count(*)::int`,
    })
    .from(attachmentDocumentPages)
    .where(
      and(
        inArray(attachmentDocumentPages.visionStatus, [
          "failed",
          "pending",
          "processing",
        ]),
        isNotNull(attachmentDocumentPages.visionError),
        sql`length(trim(${attachmentDocumentPages.visionError})) > 0`,
      ),
    )
    .groupBy(
      attachmentDocumentPages.contentHash,
      attachmentDocumentPages.visionError,
      attachmentDocumentPages.visionStatus,
    );
  return rows
    .map((row) => ({
      contentHash: row.contentHash.toLowerCase(),
      message: row.message?.trim() ?? "",
      status: row.status,
      pages: Number(row.pages) || 0,
    }))
    .filter((row) => HASH_RE.test(row.contentHash) && row.message && row.pages > 0);
}

export function errorGroupsFromHashCounts(
  rows: Array<{
    contentHash: string;
    message: string;
    pages: number;
    status?: string;
  }>,
  hashes: string[],
): ExtractionErrorGroup[] {
  const want = new Set(
    hashes.map((hash) => hash.trim().toLowerCase()).filter((hash) => HASH_RE.test(hash)),
  );
  if (want.size === 0) return [];
  const byKind = new Map<
    VisionErrorKind,
    { label: string; pages: number; docs: Set<string> }
  >();
  for (const row of rows) {
    if (!want.has(row.contentHash)) continue;
    const { kind, label } = classifyVisionError(row.message);
    const isHttp = (GEMINI_HTTP_ERROR_KINDS as string[]).includes(kind);
    if (row.status && row.status !== "failed" && !isHttp) continue;
    const cur = byKind.get(kind) ?? {
      label,
      pages: 0,
      docs: new Set<string>(),
    };
    cur.pages += row.pages;
    cur.docs.add(row.contentHash);
    byKind.set(kind, cur);
  }
  return [...byKind.entries()]
    .map(([kind, cur]) => ({
      source: "vision" as const,
      kind,
      label: cur.label,
      pages: cur.pages,
      docs: cur.docs.size,
      samples: [],
    }))
    .sort((a, b) => b.pages - a.pages || a.kind.localeCompare(b.kind));
}

/** Grouped vision failures for planned hashes — counts only, not every page. */
export async function summarizeVisionErrorGroupsForHashes(
  hashes: string[],
): Promise<ExtractionErrorGroup[]> {
  const unique = [
    ...new Set(
      hashes
        .map((hash) => hash.trim().toLowerCase())
        .filter((hash) => HASH_RE.test(hash)),
    ),
  ];
  if (unique.length === 0) return [];
  const rows = await loadFailedVisionCountsByHash();
  return errorGroupsFromHashCounts(rows, unique);
}

/** Fast SQL: vision-route totals plus remaining (pending/failed) work. */
export async function summarizeVisionBackfillCorpus(): Promise<{
  totalVisionDocs: number;
  totalVisionPages: number;
  doneVisionPages: number;
  pendingVisionDocs: number;
  pendingVisionPages: number;
  queuedVisionPages: number;
  failedVisionPages: number;
}> {
  const db = getDb();
  const rows = await db.execute<{
    total_docs: number;
    total_pages: number;
    done_pages: number;
    remaining_docs: number;
    remaining_pages: number;
    queued_pages: number;
    failed_pages: number;
  }>(sql`
    select
      count(distinct content_hash)
        filter (where route in ('vision', 'ambiguous'))::int as total_docs,
      count(*)
        filter (where route in ('vision', 'ambiguous'))::int as total_pages,
      count(*)
        filter (
          where route in ('vision', 'ambiguous')
            and vision_status = 'done'
        )::int as done_pages,
      count(distinct content_hash)
        filter (where vision_status in ('pending', 'failed', 'processing'))::int
        as remaining_docs,
      count(*)
        filter (where vision_status in ('pending', 'failed', 'processing'))::int
        as remaining_pages,
      count(*)
        filter (where vision_status in ('pending', 'processing'))::int
        as queued_pages,
      count(*)
        filter (where vision_status = 'failed')::int as failed_pages
    from attachment_document_pages
  `);
  const row = rows.rows?.[0];
  return {
    totalVisionDocs: Number(row?.total_docs) || 0,
    totalVisionPages: Number(row?.total_pages) || 0,
    doneVisionPages: Number(row?.done_pages) || 0,
    pendingVisionDocs: Number(row?.remaining_docs) || 0,
    pendingVisionPages: Number(row?.remaining_pages) || 0,
    queuedVisionPages: Number(row?.queued_pages) || 0,
    failedVisionPages: Number(row?.failed_pages) || 0,
  };
}

export async function listPendingVisionPageNos(
  contentHash: string,
): Promise<number[]> {
  const hash = contentHash.trim().toLowerCase();
  if (!HASH_RE.test(hash)) return [];
  const db = getDb();
  const rows = await db.execute<{ page_no: number }>(sql`
    select page_no
    from attachment_document_pages
    where content_hash = ${hash}
      and vision_status in ('pending', 'failed')
    order by page_no
  `);
  return (rows.rows ?? [])
    .map((r) => Number(r.page_no))
    .filter((n) => Number.isInteger(n) && n >= 1);
}

/** Requeue failed vision pages for a hash so processVisionForDocument picks them up. */
export async function requeueFailedVisionPagesForHash(
  contentHash: string,
): Promise<number> {
  return requeueFailedVisionPagesForHashes([contentHash]);
}

/** Reset failed vision rows for many hashes in one update (run start). */
export async function requeueFailedVisionPagesForHashes(
  hashes: string[],
): Promise<number> {
  const unique = [
    ...new Set(
      hashes
        .map((hash) => hash.trim().toLowerCase())
        .filter((hash) => HASH_RE.test(hash)),
    ),
  ];
  if (unique.length === 0) return 0;
  const db = getDb();
  const updated = await db
    .update(attachmentDocumentPages)
    .set({
      visionStatus: "pending",
      visionError: null,
      visionAttempts: 0,
    })
    .where(
      and(
        inArray(attachmentDocumentPages.contentHash, unique),
        eq(attachmentDocumentPages.visionStatus, "failed"),
      ),
    )
    .returning({ pageNo: attachmentDocumentPages.pageNo });
  return updated.length;
}

async function listVisionPendingByHash(): Promise<Map<string, number[]>> {
  const db = getDb();
  const rows = await db.execute<{ content_hash: string; page_no: number }>(sql`
    select content_hash, page_no
    from attachment_document_pages
    where vision_status in ('pending', 'failed')
    order by content_hash, page_no
  `);
  const byHash = new Map<string, number[]>();
  for (const row of rows.rows ?? []) {
    const hash = String(row.content_hash).toLowerCase();
    const pageNo = Number(row.page_no);
    if (!HASH_RE.test(hash) || !Number.isInteger(pageNo) || pageNo < 1) continue;
    const list = byHash.get(hash) ?? [];
    list.push(pageNo);
    byHash.set(hash, list);
  }
  return byHash;
}

/**
 * Build a planned doc list for the chosen mode.
 * Docling scan may take tens of seconds (per-page cache walk).
 */
export async function planExtractionBackfill(options: {
  mode: ExtractionBackfillMode;
  docLimit: number | null;
}): Promise<ExtractionBackfillPlan> {
  const mode = options.mode;
  const needsDocling = mode === "docling_only" || mode === "full";
  const needsVision = mode === "vision_only" || mode === "full";

  let doclingDocs: DoclingBackfillDoc[] = [];
  if (needsDocling) {
    doclingDocs = await listDoclingBackfillDocs();
  }

  const visionByHash = needsVision
    ? await listVisionPendingByHash()
    : new Map<string, number[]>();

  const corpusUncachedDoclingPages = doclingDocs
    .filter((d) => d.hasPdf)
    .reduce((n, d) => n + d.uncachedPages.length, 0);
  const corpusPendingDoclingDocs = doclingDocs.filter(
    (d) => d.hasPdf && d.uncachedPages.length > 0,
  ).length;
  const corpusPendingVisionPages = [...visionByHash.values()].reduce(
    (n, pages) => n + pages.length,
    0,
  );
  const corpusPendingVisionDocs = visionByHash.size;

  const doclingByHash = new Map(
    doclingDocs.map((d) => [d.contentHash, d] as const),
  );

  const allHashes = new Set<string>();
  if (needsDocling) {
    for (const d of doclingDocs) {
      if (d.hasPdf && d.uncachedPages.length > 0) allHashes.add(d.contentHash);
    }
  }
  if (needsVision) {
    for (const hash of visionByHash.keys()) allHashes.add(hash);
  }

  const candidates: ExtractionBackfillPlanDoc[] = [];
  let missingPdfDocs = 0;

  for (const contentHash of allHashes) {
    const docling = doclingByHash.get(contentHash);
    const pdfPath =
      docling?.hasPdf === true
        ? true
        : Boolean(await resolveCachedPdfAbsolutePath(contentHash));
    // Images may be vision-only without .pdf — processVisionForDocument handles them.
    const hasCachedBytes = pdfPath || visionByHash.has(contentHash);

    const doclingPages =
      needsDocling && docling?.hasPdf ? docling.uncachedPages : [];
    const visionPages = needsVision ? (visionByHash.get(contentHash) ?? []) : [];

    if (doclingPages.length === 0 && visionPages.length === 0) continue;

    if (!hasCachedBytes) {
      missingPdfDocs += 1;
      continue;
    }

    candidates.push({
      contentHash,
      hasPdf: Boolean(pdfPath),
      doclingPages,
      visionPages,
    });
  }

  // Limited runs: stratified by remaining page work (small/medium/large),
  // not fattest-first — sample mean ≈ corpus mean. Unlimited: stable hash order.
  const selected =
    options.docLimit == null
      ? [...candidates].sort((a, b) =>
          a.contentHash.localeCompare(b.contentHash),
        )
      : selectRepresentativeDocs(candidates, options.docLimit);

  const totalDoclingPages = selected.reduce(
    (n, d) => n + d.doclingPages.length,
    0,
  );
  const totalVisionPages = selected.reduce(
    (n, d) => n + d.visionPages.length,
    0,
  );

  return {
    mode,
    docs: selected,
    totalDoclingPages,
    totalVisionPages,
    totalPages: totalDoclingPages + totalVisionPages,
    corpusUncachedDoclingPages,
    corpusPendingDoclingDocs,
    corpusPendingVisionPages,
    corpusPendingVisionDocs,
    missingPdfDocs,
  };
}
