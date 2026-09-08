import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentDocumentPages,
  attachmentDocuments,
  documentChunks,
  emailAttachments,
  emails,
} from "@/lib/db/schema";
import {
  chunkAttachmentMarkdown,
  chunkEmailBody,
  chunkVisionPage,
  type CorpusChunk,
} from "@/lib/rag/chunk";
import {
  corpusIndexDocConcurrencyFromEnv,
  mapWithConcurrency,
} from "@/lib/rag/concurrency";
import { embedTexts, EMBEDDING_MODEL } from "@/lib/rag/embed";
import {
  estimateEmbeddingCostUsd,
  type EmbeddingUsage,
} from "@/lib/rag/cost";
import { sanitizePageVisionMarkdown } from "@/lib/email/page-vision-shared";
import { resolveAttachmentStoragePath } from "@/lib/email/attachment-markdown-shared";
import { readExtractArtifactText } from "@/lib/storage/extract-artifacts";

const DB_UPSERT_BATCH = 100;

type PreparedChunkItem = {
  id: string;
  sourceKind: "email_body" | "attachment_markdown" | "attachment_vision_page";
  emailId: string | null;
  contentHash: string | null;
  pageNo: number | null;
  chunk: CorpusChunk;
  metadata: Record<string, unknown>;
};

type AttachmentMetaRow = {
  contentHash: string;
  attachmentId: string | null;
  emailId: string | null;
  filename: string | null;
  subject: string | null;
  receivedAt: string | null;
};

export type IndexSliceOptions = {
  /** Maximum number of source items (emails / attachments / vision pages) to index in this run. */
  batchSize?: number;
  /** Whether to prioritize emails first, attachments, or all. Default "balanced" */
  mode?: "all" | "emails" | "attachments" | "vision";
};

export type IndexSliceResult = {
  emailsProcessed: number;
  attachmentsProcessed: number;
  visionPagesProcessed: number;
  chunksCreated: number;
  embeddingsComputed: number;
  embeddingsReused: number;
  inputTokens: number;
  costUsd: number;
  tokenSource: "api" | "estimate";
  remainingEmails: number;
  remainingAttachments: number;
  remainingVisionPages: number;
  errors: string[];
};

export type CorpusIndexStatus = {
  totalEmails: number;
  indexedEmails: number;
  totalParsedAttachments: number;
  indexedAttachments: number;
  totalDoneVisionPages: number;
  indexedVisionPages: number;
  totalChunks: number;
  lastIndexedAt: string | null;
};

/**
 * Returns overall index statistics across emails, attachments, and vision pages.
 * Uses one SQL round-trip to avoid exhausting the Supabase session pooler during
 * continuous indexing + 1s status polling.
 */
export async function getCorpusIndexStatus(): Promise<CorpusIndexStatus> {
  const db = getDb();

  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM emails) AS total_emails,
      (SELECT count(*)::int FROM emails e WHERE EXISTS (
        SELECT 1 FROM document_chunks dc
        WHERE dc.email_id = e.id AND dc.source_kind = 'email_body'
      )) AS indexed_emails,
      (SELECT count(*)::int FROM attachment_documents
        WHERE parse_status = 'parsed' AND markdown_path IS NOT NULL) AS total_parsed_attachments,
      (SELECT count(*)::int FROM attachment_documents ad
        WHERE ad.parse_status = 'parsed' AND ad.markdown_path IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM document_chunks dc
            WHERE dc.content_hash = ad.content_hash
              AND dc.source_kind = 'attachment_markdown'
          )) AS indexed_attachments,
      (SELECT count(*)::int FROM attachment_document_pages
        WHERE vision_status = 'done' AND artifact_path IS NOT NULL) AS total_done_vision_pages,
      (SELECT count(*)::int FROM attachment_document_pages adp
        WHERE adp.vision_status = 'done' AND adp.artifact_path IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM document_chunks dc
            WHERE dc.content_hash = adp.content_hash
              AND dc.page_no = adp.page_no
              AND dc.source_kind = 'attachment_vision_page'
          )) AS indexed_vision_pages,
      coalesce(
        (SELECT n_live_tup::int FROM pg_stat_user_tables WHERE relname = 'document_chunks'),
        0
      ) AS total_chunks
  `);

  const rows = (result.rows ?? result) as Array<{
    total_emails: number;
    indexed_emails: number;
    total_parsed_attachments: number;
    indexed_attachments: number;
    total_done_vision_pages: number;
    indexed_vision_pages: number;
    total_chunks: number;
  }>;
  const row = rows[0];

  return {
    totalEmails: row?.total_emails ?? 0,
    indexedEmails: row?.indexed_emails ?? 0,
    totalParsedAttachments: row?.total_parsed_attachments ?? 0,
    indexedAttachments: row?.indexed_attachments ?? 0,
    totalDoneVisionPages: row?.total_done_vision_pages ?? 0,
    indexedVisionPages: row?.indexed_vision_pages ?? 0,
    totalChunks: row?.total_chunks ?? 0,
    lastIndexedAt: null,
  };
}

async function loadAttachmentMetaByHash(
  contentHashes: string[],
): Promise<Map<string, AttachmentMetaRow>> {
  if (contentHashes.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({
      contentHash: emailAttachments.contentHash,
      attachmentId: emailAttachments.id,
      emailId: emailAttachments.emailId,
      filename: emailAttachments.filename,
      subject: emails.subject,
      receivedAt: emails.receivedAt,
    })
    .from(emailAttachments)
    .leftJoin(emails, eq(emails.id, emailAttachments.emailId))
    .where(inArray(emailAttachments.contentHash, contentHashes));

  const map = new Map<string, AttachmentMetaRow>();
  for (const row of rows) {
    if (!row.contentHash || map.has(row.contentHash)) continue;
    map.set(row.contentHash, {
      contentHash: row.contentHash,
      attachmentId: row.attachmentId ?? null,
      emailId: row.emailId ?? null,
      filename: row.filename ?? null,
      subject: row.subject ?? null,
      receivedAt: row.receivedAt ?? null,
    });
  }
  return map;
}

async function upsertPreparedChunkRows(
  rows: Array<{
    id: string;
    sourceKind: PreparedChunkItem["sourceKind"];
    emailId: string | null;
    contentHash: string | null;
    pageNo: number | null;
    chunkIndex: number;
    chunkText: string;
    charStart: number | null;
    charEnd: number | null;
    metadataJson: string;
    contentHashDedup: string;
    embedding: number[] | null;
    embedModel: string;
    indexedAt: string;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;

  const db = getDb();
  let written = 0;

  for (let i = 0; i < rows.length; i += DB_UPSERT_BATCH) {
    const batch = rows.slice(i, i + DB_UPSERT_BATCH);
    await db
      .insert(documentChunks)
      .values(batch)
      .onConflictDoUpdate({
        target: documentChunks.id,
        set: {
          chunkText: sql`excluded.chunk_text`,
          charStart: sql`excluded.char_start`,
          charEnd: sql`excluded.char_end`,
          metadataJson: sql`excluded.metadata_json`,
          contentHashDedup: sql`excluded.content_hash_dedup`,
          embedding: sql`excluded.embedding`,
          embedModel: sql`excluded.embed_model`,
          indexedAt: sql`excluded.indexed_at`,
        },
      });
    written += batch.length;
  }

  return written;
}

/**
 * Run an incremental indexing slice. Idempotent and safe to call concurrently with
 * the background vision backfill.
 */
export async function runIncrementalIndexSlice(
  options?: IndexSliceOptions,
): Promise<IndexSliceResult> {
  const db = getDb();
  const batchSize = Math.max(1, Math.min(100, options?.batchSize ?? 25));
  const mode = options?.mode ?? "all";

  const result: IndexSliceResult = {
    emailsProcessed: 0,
    attachmentsProcessed: 0,
    visionPagesProcessed: 0,
    chunksCreated: 0,
    embeddingsComputed: 0,
    embeddingsReused: 0,
    inputTokens: 0,
    costUsd: 0,
    tokenSource: "api",
    remainingEmails: 0,
    remainingAttachments: 0,
    remainingVisionPages: 0,
    errors: [],
  };

  const nowIso = new Date().toISOString();
  const docConcurrency = corpusIndexDocConcurrencyFromEnv();

  async function persistPreparedChunks(items: PreparedChunkItem[]) {
    if (items.length === 0) return;

    const dedupHashes = Array.from(
      new Set(items.map((it) => it.chunk.contentHashDedup)),
    );

    const existingRows = await db
      .select({
        contentHashDedup: documentChunks.contentHashDedup,
        embedding: documentChunks.embedding,
      })
      .from(documentChunks)
      .where(
        and(
          inArray(documentChunks.contentHashDedup, dedupHashes),
          isNotNull(documentChunks.embedding),
        ),
      );

    const knownEmbeddingMap = new Map<string, number[]>();
    for (const row of existingRows) {
      if (row.embedding && !knownEmbeddingMap.has(row.contentHashDedup)) {
        knownEmbeddingMap.set(row.contentHashDedup, row.embedding);
      }
    }

    const chunksNeedingEmbed: Array<{ index: number; text: string }> = [];
    for (let i = 0; i < items.length; i++) {
      const hash = items[i].chunk.contentHashDedup;
      if (!knownEmbeddingMap.has(hash)) {
        chunksNeedingEmbed.push({ index: i, text: items[i].chunk.chunkText });
      }
    }

    if (chunksNeedingEmbed.length > 0) {
      const embedded = await embedTexts(
        chunksNeedingEmbed.map((entry) => entry.text),
      );
      for (let j = 0; j < chunksNeedingEmbed.length; j++) {
        const itemIdx = chunksNeedingEmbed[j].index;
        knownEmbeddingMap.set(
          items[itemIdx].chunk.contentHashDedup,
          embedded.vectors[j],
        );
      }
      result.embeddingsComputed += embedded.vectors.length;
      accumulateEmbeddingUsage(result, embedded.usage);
    }

    result.embeddingsReused += items.length - chunksNeedingEmbed.length;

    const rows = items.map((item) => ({
      id: item.id,
      sourceKind: item.sourceKind,
      emailId: item.emailId,
      contentHash: item.contentHash,
      pageNo: item.pageNo,
      chunkIndex: item.chunk.chunkIndex,
      chunkText: item.chunk.chunkText,
      charStart: item.chunk.charStart,
      charEnd: item.chunk.charEnd,
      metadataJson: JSON.stringify(item.metadata),
      contentHashDedup: item.chunk.contentHashDedup,
      embedding: knownEmbeddingMap.get(item.chunk.contentHashDedup) ?? null,
      embedModel: EMBEDDING_MODEL,
      indexedAt: nowIso,
    }));

    result.chunksCreated += await upsertPreparedChunkRows(rows);
  }

  // 1. Process Emails
  if (mode === "all" || mode === "emails") {
    const unindexedEmails = await db
      .select({
        id: emails.id,
        subject: emails.subject,
        fromAddress: emails.fromAddress,
        receivedAt: emails.receivedAt,
        threadId: emails.threadId,
        bodyText: emails.bodyText,
        bodyTextUnique: emails.bodyTextUnique,
      })
      .from(emails)
      .where(
        sql`not exists (
          select 1 from document_chunks dc
          where dc.email_id = ${emails.id}
            and dc.source_kind = 'email_body'
        )`,
      )
      .limit(batchSize);

    const emailPrepared: PreparedChunkItem[] = [];
    await mapWithConcurrency(unindexedEmails, docConcurrency, async (email) => {
      try {
        const { chunks, metadata } = chunkEmailBody(email);
        if (chunks.length === 0) return;
        emailPrepared.push(
          ...chunks.map((c) => ({
            id: `email_body:${email.id}:${c.chunkIndex}`,
            sourceKind: "email_body" as const,
            emailId: email.id,
            contentHash: null,
            pageNo: null,
            chunk: c,
            metadata,
          })),
        );
        result.emailsProcessed++;
      } catch (err) {
        result.errors.push(
          `Email ${email.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    await persistPreparedChunks(emailPrepared);
  }

  // 2. Process Attachment Markdown
  if (mode === "all" || mode === "attachments") {
    const unindexedAttachments = await db
      .select({
        contentHash: attachmentDocuments.contentHash,
        markdownPath: attachmentDocuments.markdownPath,
        mimeType: attachmentDocuments.mimeType,
      })
      .from(attachmentDocuments)
      .where(
        and(
          eq(attachmentDocuments.parseStatus, "parsed"),
          isNotNull(attachmentDocuments.markdownPath),
          sql`not exists (
            select 1 from document_chunks dc
            where dc.content_hash = ${attachmentDocuments.contentHash}
              and dc.source_kind = 'attachment_markdown'
          )`,
        ),
      )
      .limit(batchSize);

    const attachmentMetaByHash = await loadAttachmentMetaByHash(
      unindexedAttachments.map((att) => att.contentHash),
    );
    const attachmentPrepared: PreparedChunkItem[] = [];

    await mapWithConcurrency(
      unindexedAttachments,
      docConcurrency,
      async (att) => {
        try {
          if (!att.markdownPath) return;
          const candidatePath = resolveAttachmentStoragePath(att.markdownPath);
          const markdown = await readExtractArtifactText(candidatePath);
          if (!markdown?.trim()) return;

          const metaRow = attachmentMetaByHash.get(att.contentHash);
          const { chunks, metadata } = chunkAttachmentMarkdown(
            {
              contentHash: att.contentHash,
              attachmentId: metaRow?.attachmentId ?? null,
              filename: metaRow?.filename ?? "attachment",
              mimeType: att.mimeType,
              emailId: metaRow?.emailId ?? null,
              subject: metaRow?.subject ?? null,
              receivedAt: metaRow?.receivedAt ?? null,
            },
            markdown,
          );
          if (chunks.length === 0) return;

          attachmentPrepared.push(
            ...chunks.map((c) => ({
              id: `att_md:${att.contentHash}:${c.chunkIndex}`,
              sourceKind: "attachment_markdown" as const,
              emailId: metaRow?.emailId ?? null,
              contentHash: att.contentHash,
              pageNo: null,
              chunk: c,
              metadata,
            })),
          );
          result.attachmentsProcessed++;
        } catch (err) {
          result.errors.push(
            `Attachment ${att.contentHash}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
    await persistPreparedChunks(attachmentPrepared);
  }

  // 3. Process Vision Pages
  if (mode === "all" || mode === "vision") {
    const unindexedVisionPages = await db
      .select({
        contentHash: attachmentDocumentPages.contentHash,
        pageNo: attachmentDocumentPages.pageNo,
        artifactPath: attachmentDocumentPages.artifactPath,
      })
      .from(attachmentDocumentPages)
      .where(
        and(
          eq(attachmentDocumentPages.visionStatus, "done"),
          isNotNull(attachmentDocumentPages.artifactPath),
          sql`not exists (
            select 1 from document_chunks dc
            where dc.content_hash = ${attachmentDocumentPages.contentHash}
              and dc.page_no = ${attachmentDocumentPages.pageNo}
              and dc.source_kind = 'attachment_vision_page'
          )`,
        ),
      )
      .limit(batchSize);

    const visionMetaByHash = await loadAttachmentMetaByHash(
      Array.from(new Set(unindexedVisionPages.map((page) => page.contentHash))),
    );
    const visionPrepared: PreparedChunkItem[] = [];

    await mapWithConcurrency(
      unindexedVisionPages,
      docConcurrency,
      async (page) => {
        try {
          if (!page.artifactPath) return;
          const candidatePath = resolveAttachmentStoragePath(page.artifactPath);
          const rawText = await readExtractArtifactText(candidatePath);
          if (!rawText?.trim()) return;

          const sanitized = sanitizePageVisionMarkdown(rawText).trim();
          if (!sanitized) return;

          const metaRow = visionMetaByHash.get(page.contentHash);
          const { chunks, metadata } = chunkVisionPage(
            {
              contentHash: page.contentHash,
              pageNo: page.pageNo,
              attachmentId: metaRow?.attachmentId ?? null,
              filename: metaRow?.filename ?? "attachment",
              emailId: metaRow?.emailId ?? null,
              subject: metaRow?.subject ?? null,
              receivedAt: metaRow?.receivedAt ?? null,
            },
            sanitized,
          );
          if (chunks.length === 0) return;

          visionPrepared.push(
            ...chunks.map((c) => ({
              id: `att_vision:${page.contentHash}:${page.pageNo}:${c.chunkIndex}`,
              sourceKind: "attachment_vision_page" as const,
              emailId: metaRow?.emailId ?? null,
              contentHash: page.contentHash,
              pageNo: page.pageNo,
              chunk: c,
              metadata,
            })),
          );
          result.visionPagesProcessed++;
        } catch (err) {
          result.errors.push(
            `Vision ${page.contentHash} p${page.pageNo}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
    await persistPreparedChunks(visionPrepared);
  }

  // Calculate remaining counts
  const status = await getCorpusIndexStatus();
  result.remainingEmails = Math.max(0, status.totalEmails - status.indexedEmails);
  result.remainingAttachments = Math.max(
    0,
    status.totalParsedAttachments - status.indexedAttachments,
  );
  result.remainingVisionPages = Math.max(
    0,
    status.totalDoneVisionPages - status.indexedVisionPages,
  );

  return result;
}

function accumulateEmbeddingUsage(
  result: IndexSliceResult,
  usage: EmbeddingUsage,
): void {
  result.inputTokens += usage.inputTokens;
  result.costUsd = estimateEmbeddingCostUsd(result.inputTokens);
  if (usage.tokenSource === "estimate") {
    result.tokenSource = "estimate";
  }
}
