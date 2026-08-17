/**
 * Query + process helpers for the attachment extraction lab UI.
 *
 * Goal: drive every unique attachment_documents row to `parsed` via
 * Cloudflare toMarkdown (text) and/or Gemini page vision — with explicit
 * select-N processing (no process-everything control).
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { parseAttachmentDocument } from "@/lib/email/attachment-markdown";
import { isConvertibleMime } from "@/lib/email/attachment-markdown-shared";
import { isVisionImageExt } from "@/lib/email/attachment-vision-image-shared";
import {
  processVisionForDocument,
  type PageVisionBatchResult,
} from "@/lib/email/page-vision";

export type ExtractionListFilter =
  | "needs_work"
  | "parsed"
  | "failed"
  | "all";

export type ExtractionListKind = "all" | "pdf" | "image" | "other";

export type ExtractionListSort =
  | "filename_asc"
  | "filename_desc"
  | "pages_asc"
  | "pages_desc";

export type ExtractionPath = "text" | "vision" | "mixed" | "unknown";

export type ExtractionDocSummary = {
  contentHash: string;
  filename: string | null;
  mimeType: string | null;
  ext: string | null;
  kind: "pdf" | "image" | "other";
  parseStatus: string;
  pageCount: number | null;
  path: ExtractionPath;
  pendingVision: number;
  doneVision: number;
  failedVision: number;
  visionCostUsd: number;
  cfTokens: number | null;
  parseError: string | null;
};

export type ExtractionCostBucket = {
  count: number;
  visionCostUsd: number;
  cfTokens: number;
  visionDocs: number;
  textOnlyDocs: number;
};

export type ExtractionCostSummary = {
  totalVisionCostUsd: number;
  totalCfTokens: number;
  byKind: Record<"pdf" | "image" | "other", ExtractionCostBucket>;
  byPath: {
    textOnly: ExtractionCostBucket;
    vision: ExtractionCostBucket;
  };
  /** Docs still short of `parsed` with no pending vision (queue). */
  needsWork: number;
  parsed: number;
  failed: number;
  total: number;
};

export type ExtractionProcessFileResult = {
  contentHash: string;
  filename: string | null;
  kind: "pdf" | "image" | "other";
  path: ExtractionPath;
  parseStatusBefore: string | null;
  parseStatusAfter: string | null;
  markdownRan: boolean;
  vision: PageVisionBatchResult | null;
  visionCostUsd: number;
  error: string | null;
};

export type ExtractionProcessResult = {
  processed: number;
  markdownRan: number;
  visionRan: number;
  visionCostUsd: number;
  files: ExtractionProcessFileResult[];
};

export const EXTRACTION_LIST_FILTERS: ExtractionListFilter[] = [
  "needs_work",
  "parsed",
  "failed",
  "all",
];

export const EXTRACTION_LIST_KINDS: ExtractionListKind[] = [
  "all",
  "pdf",
  "image",
  "other",
];

export const EXTRACTION_LIST_SORTS: ExtractionListSort[] = [
  "filename_asc",
  "filename_desc",
  "pages_asc",
  "pages_desc",
];

/** Hard cap so the UI cannot accidentally dump the full queue. */
export const EXTRACTION_PROCESS_MAX_HASHES = 20;

export function isExtractionListFilter(
  value: string,
): value is ExtractionListFilter {
  return (EXTRACTION_LIST_FILTERS as readonly string[]).includes(value);
}

export function isExtractionListKind(
  value: string,
): value is ExtractionListKind {
  return (EXTRACTION_LIST_KINDS as readonly string[]).includes(value);
}

export function isExtractionListSort(
  value: string,
): value is ExtractionListSort {
  return (EXTRACTION_LIST_SORTS as readonly string[]).includes(value);
}

export function classifyExtractionKind(
  mimeType: string | null | undefined,
  ext: string | null | undefined,
): "pdf" | "image" | "other" {
  const mime = mimeType?.toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime.startsWith("image/") || isVisionImageExt(ext)) return "image";
  if (mime.includes("pdf") || ext?.toLowerCase() === ".pdf") return "pdf";
  return "other";
}

function classifyPath(input: {
  kind: "pdf" | "image" | "other";
  visionPages: number;
  textPages: number;
  pageRows: number;
}): ExtractionPath {
  if (input.kind === "image") return "vision";
  if (input.pageRows === 0) {
    return input.kind === "pdf" ? "unknown" : "text";
  }
  if (input.visionPages > 0 && input.textPages > 0) return "mixed";
  if (input.visionPages > 0) return "vision";
  return "text";
}

function emptyBucket(): ExtractionCostBucket {
  return {
    count: 0,
    visionCostUsd: 0,
    cfTokens: 0,
    visionDocs: 0,
    textOnlyDocs: 0,
  };
}

function kindSql(kind: ExtractionListKind) {
  if (kind === "image") {
    return sql`and lower(coalesce(d.mime_type, '')) like 'image/%'`;
  }
  if (kind === "pdf") {
    return sql`and (
      lower(coalesce(d.mime_type, '')) like 'application/pdf%'
      or lower(coalesce(d.ext, '')) = '.pdf'
    )`;
  }
  if (kind === "other") {
    return sql`and not (
      lower(coalesce(d.mime_type, '')) like 'image/%'
      or lower(coalesce(d.mime_type, '')) like 'application/pdf%'
      or lower(coalesce(d.ext, '')) = '.pdf'
    )`;
  }
  return sql``;
}

function filterHavingSql(filter: ExtractionListFilter) {
  // needs_work: markdown still open, or vision pages still pending/processing.
  if (filter === "needs_work") {
    return sql`(
      d.parse_status in ('pending', 'parsing', 'failed', 'needs_ocr')
      or coalesce(agg.pending_vision, 0) > 0
      or coalesce(agg.processing_vision, 0) > 0
    )`;
  }
  if (filter === "parsed") {
    return sql`(
      d.parse_status = 'parsed'
      and coalesce(agg.pending_vision, 0) = 0
      and coalesce(agg.processing_vision, 0) = 0
    )`;
  }
  // Soft markdown errors stay `pending` with parse_error until attempts exhaust —
  // still belong in Failed so the tab matches what the user saw in the last run.
  if (filter === "failed") {
    return sql`(
      d.parse_status = 'failed'
      or (
        d.parse_error is not null
        and btrim(d.parse_error) <> ''
        and d.parse_status in ('pending', 'parsing', 'failed')
      )
      or coalesce(agg.failed_vision, 0) > 0
    )`;
  }
  return sql`true`;
}

export type ExtractionFilterCounts = {
  filter: Record<ExtractionListFilter, number>;
  /** Kind counts scoped to the active status filter (and search, if any). */
  kind: Record<ExtractionListKind, number>;
};

export async function getExtractionFilterCounts(options?: {
  filter?: ExtractionListFilter;
  search?: string;
}): Promise<ExtractionFilterCounts> {
  const db = getDb();
  const activeFilter = options?.filter ?? "needs_work";
  const search = options?.search?.trim().toLowerCase() ?? "";
  const searchSql = search
    ? sql`and (
        lower(d.content_hash) like ${`%${search}%`}
        or exists (
          select 1 from email_attachments ea
          where ea.content_hash = d.content_hash
            and lower(ea.filename) like ${`%${search}%`}
        )
      )`
    : sql``;

  const rowsResult = await db.execute<{
    filter_key: string;
    kind_key: string;
    n: number;
  }>(sql`
    with page_agg as (
      select
        content_hash,
        count(*) filter (where vision_status = 'pending')::int as pending_vision,
        count(*) filter (where vision_status = 'processing')::int as processing_vision,
        count(*) filter (where vision_status = 'failed')::int as failed_vision
      from attachment_document_pages
      group by content_hash
    ),
    base as (
      select
        d.content_hash,
        case
          when lower(coalesce(d.mime_type, '')) like 'image/%'
            or lower(coalesce(d.ext, '')) in ('.png', '.jpg', '.jpeg', '.gif', '.webp')
            then 'image'
          when lower(coalesce(d.mime_type, '')) like 'application/pdf%'
            or lower(coalesce(d.ext, '')) = '.pdf'
            then 'pdf'
          else 'other'
        end as kind_key,
        (
          d.parse_status in ('pending', 'parsing', 'failed', 'needs_ocr')
          or coalesce(agg.pending_vision, 0) > 0
          or coalesce(agg.processing_vision, 0) > 0
        ) as is_needs_work,
        (
          d.parse_status = 'parsed'
          and coalesce(agg.pending_vision, 0) = 0
          and coalesce(agg.processing_vision, 0) = 0
        ) as is_parsed,
        (
          d.parse_status = 'failed'
          or (
            d.parse_error is not null
            and btrim(d.parse_error) <> ''
            and d.parse_status in ('pending', 'parsing', 'failed')
          )
          or coalesce(agg.failed_vision, 0) > 0
        ) as is_failed
      from attachment_documents d
      left join page_agg agg on agg.content_hash = d.content_hash
      where true
      ${searchSql}
    )
    select filter_key, kind_key, count(*)::int as n
    from (
      select 'needs_work' as filter_key, kind_key from base where is_needs_work
      union all
      select 'parsed', kind_key from base where is_parsed
      union all
      select 'failed', kind_key from base where is_failed
      union all
      select 'all', kind_key from base
    ) exploded
    group by filter_key, kind_key
  `);

  const filterCounts: ExtractionFilterCounts["filter"] = {
    needs_work: 0,
    parsed: 0,
    failed: 0,
    all: 0,
  };
  const kindCounts: ExtractionFilterCounts["kind"] = {
    all: 0,
    pdf: 0,
    image: 0,
    other: 0,
  };

  for (const row of rowsResult.rows ?? []) {
    const n = Number(row.n) || 0;
    if (
      row.filter_key === "needs_work" ||
      row.filter_key === "parsed" ||
      row.filter_key === "failed" ||
      row.filter_key === "all"
    ) {
      filterCounts[row.filter_key] += n;
    }
    if (row.filter_key !== activeFilter) continue;
    kindCounts.all += n;
    if (
      row.kind_key === "pdf" ||
      row.kind_key === "image" ||
      row.kind_key === "other"
    ) {
      kindCounts[row.kind_key] += n;
    }
  }

  return { filter: filterCounts, kind: kindCounts };
}

export async function getExtractionCostSummary(): Promise<ExtractionCostSummary> {
  const db = getDb();

  const rowsResult = await db.execute<{
    kind: string;
    path: string;
    parse_status: string;
    needs_work: boolean;
    is_parsed: boolean;
    is_failed: boolean;
    vision_cost_usd: number;
    cf_tokens: number;
  }>(sql`
    with page_agg as (
      select
        content_hash,
        count(*)::int as page_rows,
        count(*) filter (where route in ('vision', 'ambiguous'))::int as vision_pages,
        count(*) filter (where route = 'text')::int as text_pages,
        count(*) filter (where vision_status in ('pending', 'processing'))::int as pending_open,
        coalesce(
          sum(nullif(vision_cost_usd, '')::float) filter (where vision_status = 'done'),
          0
        ) as vision_cost_usd
      from attachment_document_pages
      group by content_hash
    )
    select
      case
        when lower(coalesce(d.mime_type, '')) like 'image/%'
          or lower(coalesce(d.ext, '')) in ('.png', '.jpg', '.jpeg', '.gif', '.webp')
          then 'image'
        when lower(coalesce(d.mime_type, '')) like 'application/pdf%'
          or lower(coalesce(d.ext, '')) = '.pdf'
          then 'pdf'
        else 'other'
      end as kind,
      case
        when lower(coalesce(d.mime_type, '')) like 'image/%'
          or lower(coalesce(d.ext, '')) in ('.png', '.jpg', '.jpeg', '.gif', '.webp')
          then 'vision'
        when coalesce(p.page_rows, 0) = 0 then
          case
            when lower(coalesce(d.mime_type, '')) like 'application/pdf%'
              or lower(coalesce(d.ext, '')) = '.pdf'
            then 'unknown'
            else 'text'
          end
        when coalesce(p.vision_pages, 0) > 0 and coalesce(p.text_pages, 0) > 0 then 'mixed'
        when coalesce(p.vision_pages, 0) > 0 then 'vision'
        else 'text'
      end as path,
      d.parse_status,
      (
        d.parse_status in ('pending', 'parsing', 'failed', 'needs_ocr')
        or coalesce(p.pending_open, 0) > 0
      ) as needs_work,
      (
        d.parse_status = 'parsed'
        and coalesce(p.pending_open, 0) = 0
      ) as is_parsed,
      (
        d.parse_status = 'failed'
        or (
          d.parse_error is not null
          and btrim(d.parse_error) <> ''
          and d.parse_status in ('pending', 'parsing', 'failed')
        )
      ) as is_failed,
      coalesce(p.vision_cost_usd, 0)::float as vision_cost_usd,
      coalesce(d.tokens, 0)::int as cf_tokens
    from attachment_documents d
    left join page_agg p on p.content_hash = d.content_hash
  `);

  const byKind: ExtractionCostSummary["byKind"] = {
    pdf: emptyBucket(),
    image: emptyBucket(),
    other: emptyBucket(),
  };
  const byPath: ExtractionCostSummary["byPath"] = {
    textOnly: emptyBucket(),
    vision: emptyBucket(),
  };

  let needsWork = 0;
  let parsed = 0;
  let failed = 0;
  let totalVisionCostUsd = 0;
  let totalCfTokens = 0;

  for (const row of rowsResult.rows ?? []) {
    const kind =
      row.kind === "pdf" || row.kind === "image" || row.kind === "other"
        ? row.kind
        : "other";
    const visionCost = Number(row.vision_cost_usd) || 0;
    const cfTokens = Number(row.cf_tokens) || 0;
    const usesVision = row.path === "vision" || row.path === "mixed";

    totalVisionCostUsd += visionCost;
    totalCfTokens += cfTokens;
    if (row.needs_work) needsWork += 1;
    if (row.is_parsed) parsed += 1;
    if (row.is_failed) failed += 1;

    const kindBucket = byKind[kind];
    kindBucket.count += 1;
    kindBucket.visionCostUsd += visionCost;
    kindBucket.cfTokens += cfTokens;
    if (usesVision) kindBucket.visionDocs += 1;
    else kindBucket.textOnlyDocs += 1;

    const pathBucket = usesVision ? byPath.vision : byPath.textOnly;
    pathBucket.count += 1;
    pathBucket.visionCostUsd += visionCost;
    pathBucket.cfTokens += cfTokens;
    if (usesVision) pathBucket.visionDocs += 1;
    else pathBucket.textOnlyDocs += 1;
  }

  return {
    totalVisionCostUsd,
    totalCfTokens,
    byKind,
    byPath,
    needsWork,
    parsed,
    failed,
    total: (rowsResult.rows ?? []).length,
  };
}

export async function listExtractionDocuments(options?: {
  filter?: ExtractionListFilter;
  kind?: ExtractionListKind;
  sort?: ExtractionListSort;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{
  documents: ExtractionDocSummary[];
  total: number;
  totalVisionPages: number;
}> {
  const db = getDb();
  const filter = options?.filter ?? "needs_work";
  const kind = options?.kind ?? "all";
  const sort = options?.sort ?? "filename_asc";
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const offset = Math.max(options?.offset ?? 0, 0);
  const search = options?.search?.trim().toLowerCase() ?? "";

  const searchSql = search
    ? sql`and (
        lower(d.content_hash) like ${`%${search}%`}
        or exists (
          select 1 from email_attachments ea
          where ea.content_hash = d.content_hash
            and lower(ea.filename) like ${`%${search}%`}
        )
      )`
    : sql``;

  const orderSql =
    sort === "filename_desc"
      ? sql`lower(coalesce((
          select ea.filename from email_attachments ea
          where ea.content_hash = d.content_hash
          order by ea.id limit 1
        ), '')) desc nulls last, d.content_hash asc`
      : sort === "pages_desc"
        ? sql`coalesce(d.page_count, 0) desc, lower(coalesce((
            select ea.filename from email_attachments ea
            where ea.content_hash = d.content_hash
            order by ea.id limit 1
          ), '')) asc`
        : sort === "pages_asc"
          ? sql`coalesce(d.page_count, 0) asc, lower(coalesce((
              select ea.filename from email_attachments ea
              where ea.content_hash = d.content_hash
              order by ea.id limit 1
            ), '')) asc`
          : sql`lower(coalesce((
              select ea.filename from email_attachments ea
              where ea.content_hash = d.content_hash
              order by ea.id limit 1
            ), '')) asc nulls last, d.content_hash asc`;

  const baseFrom = sql`
    from attachment_documents d
    left join lateral (
      select
        count(*) filter (where vision_status = 'pending')::int as pending_vision,
        count(*) filter (where vision_status = 'processing')::int as processing_vision,
        count(*) filter (where vision_status = 'done')::int as done_vision,
        count(*) filter (where vision_status = 'failed')::int as failed_vision,
        count(*) filter (where route in ('vision', 'ambiguous'))::int as vision_pages,
        count(*) filter (where route = 'text')::int as text_pages,
        count(*)::int as page_rows,
        coalesce(
          sum(nullif(vision_cost_usd, '')::float) filter (where vision_status = 'done'),
          0
        ) as vision_cost_usd
      from attachment_document_pages p
      where p.content_hash = d.content_hash
    ) agg on true
    where ${filterHavingSql(filter)}
    ${kindSql(kind)}
    ${searchSql}
  `;

  const countResult = await db.execute<{
    count: number;
    total_vision_pages: number;
  }>(sql`
    select
      count(*)::int as count,
      coalesce(sum(coalesce(agg.vision_pages, 0)), 0)::int as total_vision_pages
    ${baseFrom}
  `);
  const total = Number(countResult.rows?.[0]?.count ?? 0);
  const totalVisionPages = Number(countResult.rows?.[0]?.total_vision_pages ?? 0);

  const rowsResult = await db.execute<{
    content_hash: string;
    mime_type: string | null;
    ext: string | null;
    parse_status: string;
    page_count: number | null;
    tokens: number | null;
    parse_error: string | null;
    pending_vision: number;
    done_vision: number;
    failed_vision: number;
    vision_pages: number;
    text_pages: number;
    page_rows: number;
    vision_cost_usd: number;
    filename: string | null;
  }>(sql`
    select
      d.content_hash,
      d.mime_type,
      d.ext,
      d.parse_status,
      d.page_count,
      d.tokens,
      d.parse_error,
      coalesce(agg.pending_vision, 0)::int as pending_vision,
      coalesce(agg.done_vision, 0)::int as done_vision,
      coalesce(agg.failed_vision, 0)::int as failed_vision,
      coalesce(agg.vision_pages, 0)::int as vision_pages,
      coalesce(agg.text_pages, 0)::int as text_pages,
      coalesce(agg.page_rows, 0)::int as page_rows,
      coalesce(agg.vision_cost_usd, 0)::float as vision_cost_usd,
      (
        select ea.filename from email_attachments ea
        where ea.content_hash = d.content_hash
        order by ea.id limit 1
      ) as filename
    ${baseFrom}
    order by ${orderSql}
    limit ${limit} offset ${offset}
  `);

  const documents: ExtractionDocSummary[] = (rowsResult.rows ?? []).map(
    (row) => {
      const kind = classifyExtractionKind(row.mime_type, row.ext);
      return {
        contentHash: row.content_hash,
        filename: row.filename,
        mimeType: row.mime_type,
        ext: row.ext,
        kind,
        parseStatus: row.parse_status,
        pageCount: row.page_count,
        path: classifyPath({
          kind,
          visionPages: Number(row.vision_pages) || 0,
          textPages: Number(row.text_pages) || 0,
          pageRows: Number(row.page_rows) || 0,
        }),
        pendingVision: Number(row.pending_vision) || 0,
        doneVision: Number(row.done_vision) || 0,
        failedVision: Number(row.failed_vision) || 0,
        visionCostUsd: Number(row.vision_cost_usd) || 0,
        cfTokens: row.tokens,
        parseError: row.parse_error,
      };
    },
  );

  return { documents, total, totalVisionPages };
}

function shouldRunMarkdown(input: {
  parseStatus: string;
  mimeType: string;
}): boolean {
  if (!isConvertibleMime(input.mimeType)) return false;
  return (
    input.parseStatus === "pending" ||
    input.parseStatus === "failed" ||
    input.parseStatus === "parsing"
  );
}

/**
 * Process an explicit set of content hashes (markdown then vision as needed).
 * Caps at EXTRACTION_PROCESS_MAX_HASHES.
 */
export async function processSelectedExtractionsions(
  contentHashes: string[],
): Promise<ExtractionProcessResult> {
  const unique = [
    ...new Set(
      contentHashes
        .map((h) => h.trim().toLowerCase())
        .filter((h) => /^[a-f0-9]{64}$/.test(h)),
    ),
  ].slice(0, EXTRACTION_PROCESS_MAX_HASHES);

  const db = getDb();
  const files: ExtractionProcessFileResult[] = [];
  let markdownRan = 0;
  let visionRan = 0;
  let visionCostUsd = 0;

  for (const contentHash of unique) {
    const [doc] = await db.execute<{
      mime_type: string;
      ext: string | null;
      parse_status: string;
      filename: string | null;
    }>(sql`
      select
        d.mime_type,
        d.ext,
        d.parse_status,
        (
          select ea.filename from email_attachments ea
          where ea.content_hash = d.content_hash
          order by ea.id limit 1
        ) as filename
      from attachment_documents d
      where d.content_hash = ${contentHash}
      limit 1
    `).then((r) => r.rows ?? []);

    if (!doc) {
      files.push({
        contentHash,
        filename: null,
        kind: "other",
        path: "unknown",
        parseStatusBefore: null,
        parseStatusAfter: null,
        markdownRan: false,
        vision: null,
        visionCostUsd: 0,
        error: "Document not found in attachment_documents.",
      });
      continue;
    }

    const kind = classifyExtractionKind(doc.mime_type, doc.ext);
    const parseStatusBefore = doc.parse_status;
    let parseStatusAfter: string | null = parseStatusBefore;
    let ranMarkdown = false;
    let vision: PageVisionBatchResult | null = null;
    let fileError: string | null = null;
    let fileVisionCost = 0;

    try {
      if (
        shouldRunMarkdown({
          parseStatus: parseStatusBefore,
          mimeType: doc.mime_type,
        })
      ) {
        parseStatusAfter = await parseAttachmentDocument(contentHash);
        ranMarkdown = true;
        markdownRan += 1;
      }

      const pendingPages = await db.execute<{ n: number }>(sql`
        select count(*)::int as n
        from attachment_document_pages
        where content_hash = ${contentHash}
          and vision_status in ('pending', 'failed')
      `);
      const pendingN = Number(pendingPages.rows?.[0]?.n ?? 0);

      // Images + scanned PDFs: only Gemini pages incur $; text-only PDFs stop after CF.
      if (pendingN > 0) {
        vision = await processVisionForDocument({ contentHash });
        visionRan += 1;
        fileVisionCost = vision.costUsd;
        visionCostUsd += vision.costUsd;
      }

      // Re-read status after optional vision merge.
      const [after] = await db.execute<{
        parse_status: string;
        parse_error: string | null;
        vision_pages: number;
        text_pages: number;
        page_rows: number;
      }>(sql`
        select
          d.parse_status,
          d.parse_error,
          coalesce((
            select count(*)::int from attachment_document_pages p
            where p.content_hash = d.content_hash and p.route in ('vision', 'ambiguous')
          ), 0) as vision_pages,
          coalesce((
            select count(*)::int from attachment_document_pages p
            where p.content_hash = d.content_hash and p.route = 'text'
          ), 0) as text_pages,
          coalesce((
            select count(*)::int from attachment_document_pages p
            where p.content_hash = d.content_hash
          ), 0) as page_rows
        from attachment_documents d
        where d.content_hash = ${contentHash}
        limit 1
      `).then((r) => r.rows ?? []);

      parseStatusAfter = after?.parse_status ?? parseStatusAfter;
      if (
        !fileError &&
        (parseStatusAfter === "failed" ||
          (after?.parse_error &&
            after.parse_error.trim() &&
            parseStatusAfter !== "parsed"))
      ) {
        fileError = after?.parse_error?.trim() || "Markdown conversion failed.";
      }

      files.push({
        contentHash,
        filename: doc.filename,
        kind,
        path: classifyPath({
          kind,
          visionPages: Number(after?.vision_pages) || 0,
          textPages: Number(after?.text_pages) || 0,
          pageRows: Number(after?.page_rows) || 0,
        }),
        parseStatusBefore,
        parseStatusAfter,
        markdownRan: ranMarkdown,
        vision,
        visionCostUsd: fileVisionCost,
        error: fileError,
      });
    } catch (error) {
      fileError =
        error instanceof Error ? error.message : "Extraction failed.";
      files.push({
        contentHash,
        filename: doc.filename,
        kind,
        path: kind === "image" ? "vision" : "unknown",
        parseStatusBefore,
        parseStatusAfter,
        markdownRan: ranMarkdown,
        vision,
        visionCostUsd: fileVisionCost,
        error: fileError,
      });
    }
  }

  return {
    processed: files.length,
    markdownRan,
    visionRan,
    visionCostUsd,
    files,
  };
}
