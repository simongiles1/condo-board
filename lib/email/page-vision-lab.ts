/**
 * Query helpers for the page-vision analysis lab UI.
 */

import { readFile } from "fs/promises";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentDocumentPages,
  attachmentDocuments,
  emailAttachments,
} from "@/lib/db/schema";
import { resolveCachedPdfAbsolutePath } from "@/lib/dev/golden-attachments";
import { resolveAttachmentStoragePath } from "@/lib/email/attachment-markdown-shared";
import {
  isVisionImageExt,
  isVisionImageMime,
} from "@/lib/email/attachment-vision-image-shared";
import { sanitizePageVisionMarkdown } from "@/lib/email/page-vision-shared";
import { readCachedAttachment } from "@/lib/gmail/attachments";
import { extractPdfAllPageTexts } from "@/lib/pdf/extract-page-text";
import { readExtractArtifactText } from "@/lib/storage/extract-artifacts";

export type PageVisionListFilter = "pending" | "done" | "failed" | "all";

export type PageVisionListKind = "all" | "pdf" | "image";

export type PageVisionListSort =
  | "filename_asc"
  | "filename_desc"
  | "pages_asc"
  | "pages_desc";

export const PAGE_VISION_LIST_SORTS: PageVisionListSort[] = [
  "filename_asc",
  "filename_desc",
  "pages_asc",
  "pages_desc",
];

export const PAGE_VISION_LIST_KINDS: PageVisionListKind[] = [
  "all",
  "pdf",
  "image",
];

export function isPageVisionListSort(value: string): value is PageVisionListSort {
  return (PAGE_VISION_LIST_SORTS as readonly string[]).includes(value);
}

export function isPageVisionListKind(value: string): value is PageVisionListKind {
  return (PAGE_VISION_LIST_KINDS as readonly string[]).includes(value);
}
export type PageVisionDocSummary = {
  contentHash: string;
  filename: string | null;
  mimeType: string | null;
  ext: string | null;
  parseStatus: string | null;
  pageCount: number | null;
  pending: number;
  processing: number;
  done: number;
  failed: number;
  skipped: number;
  notNeeded: number;
  visionPages: number;
  /** Vision status for page 1 only (list-row Extract page 1 affordance). */
  page1VisionStatus: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Distinct Gemini models used on done pages (stable order). */
  models: string[];
};

export type PageVisionPageDetail = {
  pageNo: number;
  route: string;
  visionStatus: string;
  chars: number;
  artifactPath: string | null;
  visionError: string | null;
  visionAttempts: number;
  visionModel: string | null;
  visionCostUsd: string | null;
  visionedAt: string | null;
  artifactMarkdown: string | null;
  /** Selectable PDF text layer for this page (pdfjs), when available. */
  nativeText: string | null;
};

export type PageVisionDocDetail = {
  contentHash: string;
  filename: string | null;
  mimeType: string | null;
  ext: string | null;
  parseStatus: string | null;
  parserName: string | null;
  pageCount: number | null;
  markdownChars: number | null;
  markdown: string | null;
  pages: PageVisionPageDetail[];
};

function isContentHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export async function listPageVisionDocuments(options?: {
  filter?: PageVisionListFilter;
  kind?: PageVisionListKind;
  sort?: PageVisionListSort;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{ documents: PageVisionDocSummary[]; total: number }> {
  const db = getDb();
  const filter = options?.filter ?? "pending";
  const kind = options?.kind ?? "all";
  const sort = options?.sort ?? "filename_asc";
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const offset = Math.max(options?.offset ?? 0, 0);
  const search = options?.search?.trim().toLowerCase() ?? "";

  const havingSql =
    filter === "pending"
      ? sql`count(*) filter (where vision_status = 'pending') > 0`
      : filter === "done"
        ? sql`count(*) filter (where vision_status = 'done') > 0`
        : filter === "failed"
          ? sql`count(*) filter (where vision_status = 'failed') > 0`
          : sql`count(*) filter (where route in ('vision', 'ambiguous')) > 0`;

  const kindSql =
    kind === "image"
      ? sql`and lower(coalesce(d.mime_type, '')) like 'image/%'`
      : kind === "pdf"
        ? sql`and (
            lower(coalesce(d.mime_type, '')) like 'application/pdf%'
            or lower(coalesce(d.ext, '')) = '.pdf'
          )`
        : sql``;

  const searchSql = search
    ? sql`and (
        lower(p.content_hash) like ${`%${search}%`}
        or exists (
          select 1 from email_attachments ea
          where ea.content_hash = p.content_hash
            and lower(ea.filename) like ${`%${search}%`}
        )
      )`
    : sql``;

  const orderSql =
    sort === "filename_desc"
      ? sql`lower(coalesce((
          select ea.filename from email_attachments ea
          where ea.content_hash = p.content_hash
          order by ea.id limit 1
        ), '')) desc nulls last, p.content_hash asc`
      : sort === "pages_desc"
        ? sql`coalesce(d.page_count, count(*)) desc, lower(coalesce((
            select ea.filename from email_attachments ea
            where ea.content_hash = p.content_hash
            order by ea.id limit 1
          ), '')) asc`
        : sort === "pages_asc"
          ? sql`coalesce(d.page_count, count(*)) asc, lower(coalesce((
              select ea.filename from email_attachments ea
              where ea.content_hash = p.content_hash
              order by ea.id limit 1
            ), '')) asc`
          : sql`lower(coalesce((
              select ea.filename from email_attachments ea
              where ea.content_hash = p.content_hash
              order by ea.id limit 1
            ), '')) asc nulls last, p.content_hash asc`;

  const countResult = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from (
      select p.content_hash
      from attachment_document_pages p
      left join attachment_documents d on d.content_hash = p.content_hash
      where true
      ${searchSql}
      ${kindSql}
      group by p.content_hash
      having ${havingSql}
    ) grouped
  `);

  const total = Number(countResult.rows?.[0]?.count ?? 0);

  const rowsResult = await db.execute<{
    content_hash: string;
    pending: number;
    processing: number;
    done: number;
    failed: number;
    skipped: number;
    not_needed: number;
    vision_pages: number;
    page1_vision_status: string | null;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    vision_models: string[] | null;
    parse_status: string | null;
    page_count: number | null;
    mime_type: string | null;
    ext: string | null;
    filename: string | null;
  }>(sql`
    select
      p.content_hash,
      count(*) filter (where p.vision_status = 'pending')::int as pending,
      count(*) filter (where p.vision_status = 'processing')::int as processing,
      count(*) filter (where p.vision_status = 'done')::int as done,
      count(*) filter (where p.vision_status = 'failed')::int as failed,
      count(*) filter (where p.vision_status = 'skipped')::int as skipped,
      count(*) filter (where p.vision_status = 'not_needed')::int as not_needed,
      count(*) filter (where p.route in ('vision', 'ambiguous'))::int as vision_pages,
      max(case when p.page_no = 1 then p.vision_status end) as page1_vision_status,
      coalesce(
        sum(nullif(p.vision_cost_usd, '')::float)
          filter (where p.vision_status = 'done'),
        0
      ) as cost_usd,
      coalesce(
        sum(p.vision_input_tokens) filter (where p.vision_status = 'done'),
        0
      )::int as input_tokens,
      coalesce(
        sum(p.vision_output_tokens) filter (where p.vision_status = 'done'),
        0
      )::int as output_tokens,
      array_agg(distinct p.vision_model)
        filter (
          where p.vision_status = 'done'
            and p.vision_model is not null
            and p.vision_model <> ''
        ) as vision_models,
      d.parse_status,
      d.page_count,
      d.mime_type,
      d.ext,
      (
        select ea.filename
        from email_attachments ea
        where ea.content_hash = p.content_hash
        order by ea.id
        limit 1
      ) as filename
    from attachment_document_pages p
    left join attachment_documents d on d.content_hash = p.content_hash
    where true
    ${searchSql}
    ${kindSql}
    group by p.content_hash, d.parse_status, d.page_count, d.mime_type, d.ext
    having ${havingSql}
    order by ${orderSql}
    limit ${limit}
    offset ${offset}
  `);

  const rows = rowsResult.rows ?? [];

  return {
    total,
    documents: rows.map((row) => ({
      contentHash: row.content_hash,
      filename: row.filename,
      mimeType: row.mime_type,
      ext: row.ext,
      parseStatus: row.parse_status,
      pageCount: row.page_count,
      pending: Number(row.pending) || 0,
      processing: Number(row.processing) || 0,
      done: Number(row.done) || 0,
      failed: Number(row.failed) || 0,
      skipped: Number(row.skipped) || 0,
      notNeeded: Number(row.not_needed) || 0,
      visionPages: Number(row.vision_pages) || 0,
      page1VisionStatus: row.page1_vision_status ?? null,
      costUsd: Number(row.cost_usd) || 0,
      inputTokens: Number(row.input_tokens) || 0,
      outputTokens: Number(row.output_tokens) || 0,
      models: Array.isArray(row.vision_models)
        ? row.vision_models.filter(
            (m): m is string => typeof m === "string" && m.length > 0,
          )
        : [],
    })),
  };
}

export async function getPageVisionDocumentDetail(
  contentHash: string,
): Promise<PageVisionDocDetail | null> {
  if (!isContentHash(contentHash)) return null;
  const hash = contentHash.toLowerCase();
  const db = getDb();

  const [doc] = await db
    .select({
      contentHash: attachmentDocuments.contentHash,
      parseStatus: attachmentDocuments.parseStatus,
      parserName: attachmentDocuments.parserName,
      pageCount: attachmentDocuments.pageCount,
      markdownChars: attachmentDocuments.markdownChars,
      markdownPath: attachmentDocuments.markdownPath,
      ext: attachmentDocuments.ext,
      mimeType: attachmentDocuments.mimeType,
    })
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, hash))
    .limit(1);

  const pages = await db
    .select({
      pageNo: attachmentDocumentPages.pageNo,
      route: attachmentDocumentPages.route,
      visionStatus: attachmentDocumentPages.visionStatus,
      chars: attachmentDocumentPages.chars,
      artifactPath: attachmentDocumentPages.artifactPath,
      visionError: attachmentDocumentPages.visionError,
      visionAttempts: attachmentDocumentPages.visionAttempts,
      visionModel: attachmentDocumentPages.visionModel,
      visionCostUsd: attachmentDocumentPages.visionCostUsd,
      visionedAt: attachmentDocumentPages.visionedAt,
    })
    .from(attachmentDocumentPages)
    .where(eq(attachmentDocumentPages.contentHash, hash))
    .orderBy(asc(attachmentDocumentPages.pageNo));

  if (!doc && pages.length === 0) return null;

  const [attachmentMeta] = await db
    .select({ filename: emailAttachments.filename })
    .from(emailAttachments)
    .where(eq(emailAttachments.contentHash, hash))
    .limit(1);

  let markdown: string | null = null;
  if (doc?.markdownPath) {
    markdown = await readExtractArtifactText(
      resolveAttachmentStoragePath(doc.markdownPath),
    );
  }
  if (markdown == null) {
    markdown = await readExtractArtifactText(
      resolveAttachmentStoragePath(`data/email-attachments/${hash}.md`),
    );
  }

  const nativeByPage = new Map<number, string>();
  const isImageDoc =
    (doc?.mimeType != null && isVisionImageMime(doc.mimeType)) ||
    isVisionImageExt(doc?.ext);
  if (!isImageDoc) {
    try {
      let pdfBytes =
        (await readCachedAttachment(hash, doc?.ext || ".pdf")) ??
        (doc?.ext && doc.ext !== ".pdf"
          ? await readCachedAttachment(hash, ".pdf")
          : null);
      if (!pdfBytes) {
        const absolute = await resolveCachedPdfAbsolutePath(hash);
        if (absolute) pdfBytes = await readFile(absolute);
      }
      if (pdfBytes) {
        const texts = await extractPdfAllPageTexts(pdfBytes);
        for (const [pageNo, text] of texts) {
          nativeByPage.set(pageNo, text);
        }
      }
    } catch (error) {
      console.warn(
        `[page-vision-lab] native text extract failed for ${hash}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const pageDetails: PageVisionPageDetail[] = [];
  for (const page of pages) {
    let artifactMarkdown: string | null = null;
    if (page.artifactPath) {
      const raw = await readExtractArtifactText(
        resolveAttachmentStoragePath(page.artifactPath),
      );
      artifactMarkdown = raw != null ? sanitizePageVisionMarkdown(raw) : null;
    }
    const nativeText = nativeByPage.get(page.pageNo)?.trim() || null;
    pageDetails.push({
      pageNo: page.pageNo,
      route: page.route,
      visionStatus: page.visionStatus,
      chars: page.chars,
      artifactPath: page.artifactPath,
      visionError: page.visionError,
      visionAttempts: page.visionAttempts,
      visionModel: page.visionModel,
      visionCostUsd: page.visionCostUsd,
      visionedAt: page.visionedAt,
      artifactMarkdown,
      nativeText,
    });
  }

  return {
    contentHash: hash,
    filename: attachmentMeta?.filename ?? null,
    mimeType: doc?.mimeType ?? null,
    ext: doc?.ext ?? null,
    parseStatus: doc?.parseStatus ?? null,
    parserName: doc?.parserName ?? null,
    pageCount: doc?.pageCount ?? null,
    markdownChars: doc?.markdownChars ?? null,
    markdown,
    pages: pageDetails,
  };
}

/** Reset selected pages to pending so the worker can (re)claim them. */
export async function requeueVisionPages(
  contentHash: string,
  pageNos: number[],
): Promise<number> {
  if (!isContentHash(contentHash) || pageNos.length === 0) return 0;
  const db = getDb();
  const hash = contentHash.toLowerCase();
  const unique = [
    ...new Set(pageNos.filter((n) => Number.isInteger(n) && n >= 1)),
  ];
  if (unique.length === 0) return 0;

  const updated = await db
    .update(attachmentDocumentPages)
    .set({
      visionStatus: "pending",
      visionError: null,
      visionAttempts: 0,
    })
    .where(
      and(
        eq(attachmentDocumentPages.contentHash, hash),
        inArray(attachmentDocumentPages.pageNo, unique),
        inArray(attachmentDocumentPages.visionStatus, [
          "failed",
          "done",
          "skipped",
          "pending",
        ]),
      ),
    )
    .returning({ pageNo: attachmentDocumentPages.pageNo });

  return updated.length;
}
