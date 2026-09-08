import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

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
import { embedTexts, EMBEDDING_MODEL } from "@/lib/rag/embed";
import { sanitizePageVisionMarkdown } from "@/lib/email/page-vision-shared";
import { resolveAttachmentStoragePath } from "@/lib/email/attachment-markdown-shared";
import { readExtractArtifactText } from "@/lib/storage/extract-artifacts";

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
 */
export async function getCorpusIndexStatus(): Promise<CorpusIndexStatus> {
  const db = getDb();

  // 1. Emails
  const [emailStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
    })
    .from(emails);

  const [indexedEmailStats] = await db
    .select({
      count: sql<number>`count(distinct ${documentChunks.emailId})::int`,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.sourceKind, "email_body"),
        isNotNull(documentChunks.emailId),
      ),
    );

  // 2. Parsed Attachments
  const [attStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
    })
    .from(attachmentDocuments)
    .where(
      and(
        eq(attachmentDocuments.parseStatus, "parsed"),
        isNotNull(attachmentDocuments.markdownPath),
      ),
    );

  const [indexedAttStats] = await db
    .select({
      count: sql<number>`count(distinct ${documentChunks.contentHash})::int`,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.sourceKind, "attachment_markdown"),
        isNotNull(documentChunks.contentHash),
      ),
    );

  // 3. Vision Pages
  const [visionStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
    })
    .from(attachmentDocumentPages)
    .where(
      and(
        eq(attachmentDocumentPages.visionStatus, "done"),
        isNotNull(attachmentDocumentPages.artifactPath),
      ),
    );

  const [indexedVisionStats] = await db
    .select({
      count: sql<number>`count(distinct (${documentChunks.contentHash} || ':' || ${documentChunks.pageNo}))::int`,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.sourceKind, "attachment_vision_page"),
        isNotNull(documentChunks.contentHash),
        isNotNull(documentChunks.pageNo),
      ),
    );

  // 4. Total Chunks & Last Indexed
  const [chunkStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      lastIndexedAt: sql<string | null>`max(${documentChunks.indexedAt})`,
    })
    .from(documentChunks);

  return {
    totalEmails: emailStats?.total ?? 0,
    indexedEmails: indexedEmailStats?.count ?? 0,
    totalParsedAttachments: attStats?.total ?? 0,
    indexedAttachments: indexedAttStats?.count ?? 0,
    totalDoneVisionPages: visionStats?.total ?? 0,
    indexedVisionPages: indexedVisionStats?.count ?? 0,
    totalChunks: chunkStats?.total ?? 0,
    lastIndexedAt: chunkStats?.lastIndexedAt ?? null,
  };
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
    remainingEmails: 0,
    remainingAttachments: 0,
    remainingVisionPages: 0,
    errors: [],
  };

  const nowIso = new Date().toISOString();

  // Helper to persist chunks with deduplication
  async function persistPreparedChunks(
    items: Array<{
      id: string;
      sourceKind: "email_body" | "attachment_markdown" | "attachment_vision_page";
      emailId: string | null;
      contentHash: string | null;
      pageNo: number | null;
      chunk: CorpusChunk;
      metadata: Record<string, unknown>;
    }>,
  ) {
    if (items.length === 0) return;

    // Check which contentHashDedup already have embeddings in document_chunks
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

    // Identify which chunks require a fresh embedding call
    const chunksNeedingEmbed: Array<{ index: number; text: string }> = [];
    for (let i = 0; i < items.length; i++) {
      const hash = items[i].chunk.contentHashDedup;
      if (!knownEmbeddingMap.has(hash)) {
        chunksNeedingEmbed.push({ index: i, text: items[i].chunk.chunkText });
      }
    }

    if (chunksNeedingEmbed.length > 0) {
      const textsToEmbed = chunksNeedingEmbed.map((c) => c.text);
      const computedVectors = await embedTexts(textsToEmbed);
      for (let j = 0; j < chunksNeedingEmbed.length; j++) {
        const itemIdx = chunksNeedingEmbed[j].index;
        const hash = items[itemIdx].chunk.contentHashDedup;
        const vec = computedVectors[j];
        knownEmbeddingMap.set(hash, vec);
      }
      result.embeddingsComputed += computedVectors.length;
    }

    result.embeddingsReused += items.length - chunksNeedingEmbed.length;

    // Insert or update chunks in document_chunks
    for (const item of items) {
      const vec = knownEmbeddingMap.get(item.chunk.contentHashDedup) ?? null;
      await db
        .insert(documentChunks)
        .values({
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
          embedding: vec,
          embedModel: EMBEDDING_MODEL,
          indexedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: documentChunks.id,
          set: {
            chunkText: item.chunk.chunkText,
            charStart: item.chunk.charStart,
            charEnd: item.chunk.charEnd,
            metadataJson: JSON.stringify(item.metadata),
            contentHashDedup: item.chunk.contentHashDedup,
            embedding: vec,
            embedModel: EMBEDDING_MODEL,
            indexedAt: nowIso,
          },
        });
      result.chunksCreated++;
    }
  }

  // 1. Process Emails
  if (mode === "all" || mode === "emails") {
    // Find unindexed emails
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
      .leftJoin(
        documentChunks,
        and(
          eq(documentChunks.emailId, emails.id),
          eq(documentChunks.sourceKind, "email_body"),
        ),
      )
      .where(isNull(documentChunks.id))
      .limit(batchSize);

    for (const email of unindexedEmails) {
      try {
        const { chunks, metadata } = chunkEmailBody(email);
        const prepared = chunks.map((c) => ({
          id: `email_body:${email.id}:${c.chunkIndex}`,
          sourceKind: "email_body" as const,
          emailId: email.id,
          contentHash: null,
          pageNo: null,
          chunk: c,
          metadata,
        }));
        await persistPreparedChunks(prepared);
        result.emailsProcessed++;
      } catch (err) {
        result.errors.push(
          `Email ${email.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
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
      .leftJoin(
        documentChunks,
        and(
          eq(documentChunks.contentHash, attachmentDocuments.contentHash),
          eq(documentChunks.sourceKind, "attachment_markdown"),
        ),
      )
      .where(
        and(
          eq(attachmentDocuments.parseStatus, "parsed"),
          isNotNull(attachmentDocuments.markdownPath),
          isNull(documentChunks.id),
        ),
      )
      .limit(batchSize);

    for (const att of unindexedAttachments) {
      try {
        if (!att.markdownPath) continue;
        const candidatePath = resolveAttachmentStoragePath(att.markdownPath);
        const markdown = await readExtractArtifactText(candidatePath);
        if (!markdown?.trim()) continue;

        // Fetch primary email metadata for this attachment
        const [metaRow] = await db
          .select({
            attachmentId: emailAttachments.id,
            emailId: emailAttachments.emailId,
            filename: emailAttachments.filename,
            subject: emails.subject,
            receivedAt: emails.receivedAt,
          })
          .from(emailAttachments)
          .leftJoin(emails, eq(emails.id, emailAttachments.emailId))
          .where(eq(emailAttachments.contentHash, att.contentHash))
          .limit(1);

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

        const prepared = chunks.map((c) => ({
          id: `att_md:${att.contentHash}:${c.chunkIndex}`,
          sourceKind: "attachment_markdown" as const,
          emailId: metaRow?.emailId ?? null,
          contentHash: att.contentHash,
          pageNo: null,
          chunk: c,
          metadata,
        }));

        await persistPreparedChunks(prepared);
        result.attachmentsProcessed++;
      } catch (err) {
        result.errors.push(
          `Attachment ${att.contentHash}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
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
      .leftJoin(
        documentChunks,
        and(
          eq(documentChunks.contentHash, attachmentDocumentPages.contentHash),
          eq(documentChunks.pageNo, attachmentDocumentPages.pageNo),
          eq(documentChunks.sourceKind, "attachment_vision_page"),
        ),
      )
      .where(
        and(
          eq(attachmentDocumentPages.visionStatus, "done"),
          isNotNull(attachmentDocumentPages.artifactPath),
          isNull(documentChunks.id),
        ),
      )
      .limit(batchSize);

    for (const page of unindexedVisionPages) {
      try {
        if (!page.artifactPath) continue;
        const candidatePath = resolveAttachmentStoragePath(page.artifactPath);
        const rawText = await readExtractArtifactText(candidatePath);
        if (!rawText?.trim()) continue;

        const sanitized = sanitizePageVisionMarkdown(rawText).trim();
        if (!sanitized) continue;

        // Fetch attachment and email metadata
        const [metaRow] = await db
          .select({
            attachmentId: emailAttachments.id,
            emailId: emailAttachments.emailId,
            filename: emailAttachments.filename,
            subject: emails.subject,
            receivedAt: emails.receivedAt,
          })
          .from(emailAttachments)
          .leftJoin(emails, eq(emails.id, emailAttachments.emailId))
          .where(eq(emailAttachments.contentHash, page.contentHash))
          .limit(1);

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

        const prepared = chunks.map((c) => ({
          id: `att_vision:${page.contentHash}:${page.pageNo}:${c.chunkIndex}`,
          sourceKind: "attachment_vision_page" as const,
          emailId: metaRow?.emailId ?? null,
          contentHash: page.contentHash,
          pageNo: page.pageNo,
          chunk: c,
          metadata,
        }));

        await persistPreparedChunks(prepared);
        result.visionPagesProcessed++;
      } catch (err) {
        result.errors.push(
          `Vision ${page.contentHash} p${page.pageNo}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
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
