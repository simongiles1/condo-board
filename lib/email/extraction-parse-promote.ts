/**
 * Promote completed Docling/vision backfill docs to parse_status=parsed.
 *
 * Docling writes a lab cache; Gemini vision only flipped needs_ocr → parsed.
 * Text PDFs stayed pending even after both pipelines finished.
 */

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentDocumentPages,
  attachmentDocuments,
} from "@/lib/db/schema";
import {
  attachmentMarkdownRelativeKey,
  canMarkExtractionParsed,
  classifySizeClass,
  DOCLING_PARSER_NAME,
  DOCLING_VISION_PARSER_NAME,
  resolveAttachmentStoragePath,
} from "@/lib/email/attachment-markdown-shared";
import {
  assembleDoclingMarkdown,
  listUncachedTextRoutePages,
  readCachedDoclingMarkdown,
  readCachedDoclingPage,
} from "@/lib/email/docling-lab";
import {
  PAGE_VISION_PARSER_NAME,
  spliceVisionPageIntoMarkdown,
} from "@/lib/email/page-vision-shared";
import {
  readExtractArtifactText,
  writeExtractArtifactText,
} from "@/lib/storage/extract-artifacts";

const HASH_RE = /^[a-f0-9]{64}$/i;

function nowIso(): string {
  return new Date().toISOString();
}

function attachmentMarkdownAbsolutePath(contentHash: string): string {
  return resolveAttachmentStoragePath(
    attachmentMarkdownRelativeKey(contentHash),
  );
}

export type PromoteParsedReason =
  | "promoted"
  | "already_parsed"
  | "not_found"
  | "vision_incomplete"
  | "uncached_text"
  | "empty_markdown";

export type PromoteParsedResult = {
  contentHash: string;
  promoted: boolean;
  reason: PromoteParsedReason;
};

async function assembleDoclingBaseMarkdown(
  contentHash: string,
): Promise<string> {
  const assembled = await readCachedDoclingMarkdown(contentHash);
  if (assembled?.trim()) return assembled.trim();

  const db = getDb();
  const rows = await db.execute<{ page_no: number }>(sql`
    select page_no
    from attachment_document_pages
    where content_hash = ${contentHash}
      and route = 'text'
    order by page_no
  `);
  const pages: Array<{ pageNo: number; markdown: string }> = [];
  for (const row of rows.rows ?? []) {
    const pageNo = Number(row.page_no);
    if (!Number.isInteger(pageNo) || pageNo < 1) continue;
    const body = await readCachedDoclingPage(contentHash, pageNo);
    if (body) pages.push({ pageNo, markdown: body });
  }
  return assembleDoclingMarkdown(pages).trim();
}

async function loadExistingAttachmentMarkdown(
  contentHash: string,
  markdownPath: string | null,
): Promise<string> {
  const candidates = [
    markdownPath ? resolveAttachmentStoragePath(markdownPath) : null,
    attachmentMarkdownAbsolutePath(contentHash),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const markdown = await readExtractArtifactText(candidate);
    if (markdown?.trim()) return markdown;
  }
  return "";
}

/**
 * If Docling text pages are cached and no vision pages are still open,
 * write the attachment `.md` and set parse_status=parsed.
 */
export async function promoteParsedIfExtractionComplete(
  contentHash: string,
): Promise<PromoteParsedResult> {
  const hash = contentHash.trim().toLowerCase();
  if (!HASH_RE.test(hash)) {
    return { contentHash: hash, promoted: false, reason: "not_found" };
  }

  const db = getDb();
  const [doc] = await db
    .select({
      parseStatus: attachmentDocuments.parseStatus,
      markdownPath: attachmentDocuments.markdownPath,
      pageCount: attachmentDocuments.pageCount,
    })
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, hash))
    .limit(1);

  if (!doc) {
    return { contentHash: hash, promoted: false, reason: "not_found" };
  }
  if (doc.parseStatus === "parsed") {
    return { contentHash: hash, promoted: false, reason: "already_parsed" };
  }

  const [vision] = await db
    .select({
      pending: sql<number>`count(*) filter (where vision_status = 'pending')::int`,
      processing: sql<number>`count(*) filter (where vision_status = 'processing')::int`,
      failed: sql<number>`count(*) filter (where vision_status = 'failed')::int`,
      done: sql<number>`count(*) filter (where vision_status = 'done')::int`,
    })
    .from(attachmentDocumentPages)
    .where(eq(attachmentDocumentPages.contentHash, hash));

  const pendingVision = Number(vision?.pending) || 0;
  const processingVision = Number(vision?.processing) || 0;
  const failedVision = Number(vision?.failed) || 0;
  const doneVision = Number(vision?.done) || 0;

  if (pendingVision > 0 || processingVision > 0 || failedVision > 0) {
    return { contentHash: hash, promoted: false, reason: "vision_incomplete" };
  }

  const uncachedTextPages = await listUncachedTextRoutePages(hash);
  if (uncachedTextPages.length > 0) {
    return { contentHash: hash, promoted: false, reason: "uncached_text" };
  }

  const doclingMarkdown = await assembleDoclingBaseMarkdown(hash);
  let markdown = doclingMarkdown;
  if (!markdown) {
    markdown = await loadExistingAttachmentMarkdown(hash, doc.markdownPath);
  }

  const donePages = await db
    .select({
      pageNo: attachmentDocumentPages.pageNo,
      artifactPath: attachmentDocumentPages.artifactPath,
    })
    .from(attachmentDocumentPages)
    .where(
      and(
        eq(attachmentDocumentPages.contentHash, hash),
        eq(attachmentDocumentPages.visionStatus, "done"),
      ),
    )
    .orderBy(attachmentDocumentPages.pageNo);

  for (const page of donePages) {
    if (!page.artifactPath) continue;
    const body = await readExtractArtifactText(
      resolveAttachmentStoragePath(page.artifactPath),
    );
    if (body == null) continue;
    markdown = spliceVisionPageIntoMarkdown(markdown, page.pageNo, body);
  }

  const trimmed = markdown.trim();
  if (
    !canMarkExtractionParsed({
      parseStatus: doc.parseStatus,
      pendingVision,
      processingVision,
      failedVision,
      hasUsableMarkdown: Boolean(trimmed),
      uncachedTextPages: uncachedTextPages.length,
    })
  ) {
    return { contentHash: hash, promoted: false, reason: "empty_markdown" };
  }

  const mdKey = attachmentMarkdownRelativeKey(hash);
  const mdAbsolute = attachmentMarkdownAbsolutePath(hash);
  await writeExtractArtifactText(mdAbsolute, `${trimmed}\n`);

  const markdownChars = trimmed.length + 1;
  const pageCount = doc.pageCount;
  const charsPerPage =
    pageCount != null && pageCount > 0
      ? Math.round(markdownChars / pageCount)
      : null;
  const hasDocling = doclingMarkdown.length > 0;
  const parserName =
    hasDocling && doneVision > 0
      ? DOCLING_VISION_PARSER_NAME
      : hasDocling
        ? DOCLING_PARSER_NAME
        : PAGE_VISION_PARSER_NAME;

  await db
    .update(attachmentDocuments)
    .set({
      parseStatus: "parsed",
      parsedAt: nowIso(),
      markdownPath: mdKey,
      markdownChars,
      charsPerPage,
      sizeClass: classifySizeClass(pageCount, markdownChars),
      parserName,
      parseError: null,
    })
    .where(eq(attachmentDocuments.contentHash, hash));

  return { contentHash: hash, promoted: true, reason: "promoted" };
}

/** Planned hashes from completed backfill runs that are still not parsed. */
export async function listOpenHashesFromCompletedBackfills(): Promise<
  string[]
> {
  const db = getDb();
  const rows = await db.execute<{ content_hash: string }>(sql`
    with hashes as (
      select distinct lower(h.hash) as content_hash
      from docling_backfill_runs r
      cross join lateral jsonb_array_elements_text(
        r.planned_hashes_json::jsonb
      ) as h(hash)
      where r.status = 'completed'
        and r.planned_hashes_json is not null
        and btrim(r.planned_hashes_json) <> ''
        and btrim(r.planned_hashes_json) <> '[]'
    )
    select h.content_hash
    from hashes h
    join attachment_documents d on d.content_hash = h.content_hash
    where d.parse_status in ('pending', 'parsing', 'needs_ocr')
    order by h.content_hash
  `);
  return (rows.rows ?? [])
    .map((row) => String(row.content_hash).toLowerCase())
    .filter((hash) => HASH_RE.test(hash));
}

export async function promoteOpenCompletedBackfillDocs(): Promise<{
  considered: number;
  promoted: number;
  skipped: Record<PromoteParsedReason, number>;
}> {
  const hashes = await listOpenHashesFromCompletedBackfills();
  const skipped: Record<PromoteParsedReason, number> = {
    promoted: 0,
    already_parsed: 0,
    not_found: 0,
    vision_incomplete: 0,
    uncached_text: 0,
    empty_markdown: 0,
  };
  let promoted = 0;
  for (const hash of hashes) {
    const result = await promoteParsedIfExtractionComplete(hash);
    if (result.promoted) promoted += 1;
    skipped[result.reason] += 1;
  }
  return { considered: hashes.length, promoted, skipped };
}
