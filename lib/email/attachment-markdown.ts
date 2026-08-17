/**
 * Attachment → Markdown conversion substrate (P0).
 *
 * Uses Cloudflare Workers AI `toMarkdown` REST API. Content-addressed by
 * SHA-256 hash so duplicate attachments across emails convert once.
 */

import { access, readFile, writeFile } from "fs/promises";

import { and, count, eq, isNull, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { attachmentDocuments, emailAttachments } from "@/lib/db/schema";
import {
  ATTACHMENT_PARSE_BATCH_SIZE,
  ATTACHMENT_PARSE_MAX_ATTEMPTS,
  attachmentMarkdownRelativeKey,
  classifySizeClass,
  extensionFromCachedPath,
  isConvertibleMime,
  MIN_CHARS_PER_PAGE,
  PARSER_NAME,
  resolveAttachmentStoragePath,
  shouldFlagNeedsOcr,
  type AttachmentParseStatus,
} from "@/lib/email/attachment-markdown-shared";
import { enrollImageAttachmentForVision } from "@/lib/email/attachment-vision-image";
import { readCachedAttachment } from "@/lib/gmail/attachments";

export {
  ATTACHMENT_PARSE_BATCH_SIZE,
  ATTACHMENT_PARSE_MAX_ATTEMPTS,
  attachmentMarkdownRelativeKey,
  classifySizeClass,
  extensionFromCachedPath,
  isConvertibleMime,
  MIN_CHARS_PER_PAGE,
  PARSER_NAME,
  resolveAttachmentStoragePath,
  SHORT_DOC_MAX_PAGES,
  type AttachmentParseStatus,
} from "@/lib/email/attachment-markdown-shared";

export type AttachmentParseBatchResult = {
  processed: number;
  parsed: number;
  needsOcr: number;
  unsupported: number;
  failed: number;
  skipped: number;
  remaining: number;
  lastError: string | null;
};

export type AttachmentParseStatusSummary = {
  pending: number;
  parsing: number;
  parsed: number;
  needsOcr: number;
  unsupported: number;
  failed: number;
  total: number;
};

type ToMarkdownResult = {
  data: string;
  tokens?: number;
  format?: string;
  mimeType?: string;
  name?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Absolute filesystem path for the Markdown sidecar (write/read). */
export function attachmentMarkdownPath(contentHash: string): string {
  return resolveAttachmentStoragePath(
    attachmentMarkdownRelativeKey(contentHash),
  );
}

/** Relative storage key persisted in attachment_documents.markdown_path. */
export function attachmentMarkdownStorageKey(contentHash: string): string {
  return attachmentMarkdownRelativeKey(contentHash);
}

/**
 * Read converted Markdown for a content hash when parseStatus is usable.
 * Returns null when missing / not yet parsed.
 */
export async function readAttachmentMarkdown(
  contentHash: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({
      parseStatus: attachmentDocuments.parseStatus,
      markdownPath: attachmentDocuments.markdownPath,
    })
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, contentHash))
    .limit(1);

  if (!row || row.parseStatus !== "parsed" || !row.markdownPath) {
    return null;
  }

  try {
    const absolute = resolveAttachmentStoragePath(row.markdownPath);
    const markdown = await readFile(absolute, "utf8");
    return markdown.trim() ? markdown : null;
  } catch {
    // Fall back to conventional sidecar location (legacy absolute path drift).
    try {
      const markdown = await readFile(
        attachmentMarkdownPath(contentHash),
        "utf8",
      );
      return markdown.trim() ? markdown : null;
    } catch {
      return null;
    }
  }
}

/**
 * Crash recovery: `parsing` rows are never polled by the batch worker.
 * Single-instance Docker has no concurrent parsers, so reclaim all of them
 * at batch start (mirrors bulk_extract stale-run reaping).
 */
export async function reclaimStaleParsingAttachmentDocuments(): Promise<number> {
  const db = getDb();
  const stuck = await db
    .select({
      contentHash: attachmentDocuments.contentHash,
      attempts: attachmentDocuments.attempts,
    })
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.parseStatus, "parsing"));

  let reclaimed = 0;
  for (const row of stuck) {
    const giveUp = row.attempts >= ATTACHMENT_PARSE_MAX_ATTEMPTS;
    await db
      .update(attachmentDocuments)
      .set({
        parseStatus: giveUp ? "failed" : "pending",
        parseError: giveUp
          ? "Interrupted while parsing (process restart) — max attempts reached."
          : "Interrupted while parsing (process restart) — requeued.",
      })
      .where(eq(attachmentDocuments.contentHash, row.contentHash));
    reclaimed += 1;
  }
  return reclaimed;
}

function resolveCloudflareConfig(): { accountId: string; apiToken: string } {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for attachment Markdown conversion.",
    );
  }
  return { accountId, apiToken };
}

/**
 * Call Cloudflare AI toMarkdown REST API.
 * Response shape (binding/REST): { data, tokens, format, mimeType, name, id }.
 */
export async function convertBytesToMarkdown(input: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
}): Promise<ToMarkdownResult> {
  const { accountId, apiToken } = resolveCloudflareConfig();
  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.bytes)], {
    type: input.mimeType || "application/octet-stream",
  });
  form.append("files", blob, input.filename);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/tomarkdown`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: form,
    },
  );

  const payload = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: ToMarkdownResult | ToMarkdownResult[];
  };

  if (!response.ok || payload.success === false) {
    const detail =
      payload.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${response.status}`;
    throw new Error(`toMarkdown failed: ${detail}`);
  }

  const first = Array.isArray(payload.result)
    ? payload.result[0]
    : payload.result;

  if (!first || typeof first.data !== "string") {
    throw new Error("toMarkdown returned no markdown data.");
  }

  return first;
}

/**
 * Enqueue (or refresh metadata for) a downloaded attachment.
 * No-op when hasValue is false, MIME is not convertible, or hash is terminal.
 */
export async function upsertAttachmentDocumentPending(input: {
  contentHash: string;
  mimeType: string;
  ext: string;
  pageCount?: number | null;
  hasValue?: boolean | null;
}): Promise<void> {
  if (input.hasValue === false) return;
  if (!isConvertibleMime(input.mimeType)) return;

  const db = getDb();
  const [existing] = await db
    .select()
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, input.contentHash));

  const seenAt = nowIso();

  if (!existing) {
    await db.insert(attachmentDocuments).values({
      contentHash: input.contentHash,
      mimeType: input.mimeType,
      ext: input.ext,
      parseStatus: "pending",
      parseError: null,
      pageCount: input.pageCount ?? null,
      attempts: 0,
      firstSeenAt: seenAt,
    });
    return;
  }

  // Refresh page count when download path learns it later; never reopen terminals.
  const terminal = new Set([
    "parsed",
    "unsupported",
    "failed",
    "needs_ocr",
  ]);
  if (terminal.has(existing.parseStatus)) {
    if (input.pageCount != null && existing.pageCount == null) {
      await db
        .update(attachmentDocuments)
        .set({ pageCount: input.pageCount })
        .where(eq(attachmentDocuments.contentHash, input.contentHash));
    }
    return;
  }

  await db
    .update(attachmentDocuments)
    .set({
      mimeType: input.mimeType,
      ext: input.ext,
      pageCount: input.pageCount ?? existing.pageCount,
    })
    .where(eq(attachmentDocuments.contentHash, input.contentHash));
}

async function markdownSidecarExists(contentHash: string): Promise<boolean> {
  try {
    await access(attachmentMarkdownPath(contentHash));
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert one pending/failed (retryable) attachment document to Markdown.
 */
export async function parseAttachmentDocument(
  contentHash: string,
): Promise<AttachmentParseStatus> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, contentHash));

  if (!row) {
    throw new Error(`attachment_documents row not found: ${contentHash}`);
  }

  if (
    row.parseStatus === "parsed" ||
    row.parseStatus === "unsupported" ||
    row.parseStatus === "needs_ocr"
  ) {
    return row.parseStatus;
  }

  if (!isConvertibleMime(row.mimeType)) {
    await db
      .update(attachmentDocuments)
      .set({
        parseStatus: "unsupported",
        parseError: `MIME type not supported for Markdown conversion: ${row.mimeType}`,
      })
      .where(eq(attachmentDocuments.contentHash, contentHash));
    return "unsupported";
  }

  // Idempotent: sidecar already present from a prior success.
  if (await markdownSidecarExists(contentHash)) {
    const existingMd = await readFile(
      attachmentMarkdownPath(contentHash),
      "utf8",
    );
    const markdownChars = existingMd.length;
    const pageCount = row.pageCount;
    const { needsOcr, charsPerPage } = shouldFlagNeedsOcr({
      pageCount,
      markdownChars,
    });

    await db
      .update(attachmentDocuments)
      .set({
        parseStatus: needsOcr ? "needs_ocr" : "parsed",
        markdownPath: attachmentMarkdownStorageKey(contentHash),
        markdownChars,
        charsPerPage,
        sizeClass: classifySizeClass(pageCount, markdownChars),
        parserName: PARSER_NAME,
        parsedAt: nowIso(),
        parseError: needsOcr
          ? `Scanned/empty conversion (${charsPerPage} chars/page < ${MIN_CHARS_PER_PAGE})`
          : null,
      })
      .where(eq(attachmentDocuments.contentHash, contentHash));
    return needsOcr ? "needs_ocr" : "parsed";
  }

  await db
    .update(attachmentDocuments)
    .set({
      parseStatus: "parsing",
      attempts: row.attempts + 1,
      parseError: null,
    })
    .where(eq(attachmentDocuments.contentHash, contentHash));

  try {
    const bytes = await readCachedAttachment(contentHash, row.ext);
    if (!bytes) {
      throw new Error(
        `Cached attachment bytes missing for ${contentHash}${row.ext}`,
      );
    }

    // Prefer a real filename from any email_attachments row for toMarkdown.
    const [attachmentMeta] = await db
      .select({
        filename: emailAttachments.filename,
        pageCount: emailAttachments.pageCount,
      })
      .from(emailAttachments)
      .where(eq(emailAttachments.contentHash, contentHash))
      .limit(1);

    const filename =
      attachmentMeta?.filename?.trim() ||
      `attachment${row.ext || ".bin"}`;
    const pageCount = row.pageCount ?? attachmentMeta?.pageCount ?? null;

    const result = await convertBytesToMarkdown({
      bytes,
      filename,
      mimeType: row.mimeType,
    });

    const markdown = result.data;
    const markdownChars = markdown.length;
    const mdAbsolute = attachmentMarkdownPath(contentHash);
    const mdKey = attachmentMarkdownStorageKey(contentHash);
    await writeFile(mdAbsolute, markdown, "utf8");

    const { needsOcr, charsPerPage } = shouldFlagNeedsOcr({
      pageCount,
      markdownChars,
    });

    const status: AttachmentParseStatus = needsOcr ? "needs_ocr" : "parsed";

    await db
      .update(attachmentDocuments)
      .set({
        parseStatus: status,
        markdownPath: mdKey,
        markdownChars,
        tokens:
          typeof result.tokens === "number" && Number.isFinite(result.tokens)
            ? Math.round(result.tokens)
            : null,
        pageCount,
        charsPerPage,
        sizeClass: classifySizeClass(pageCount, markdownChars),
        parserName: PARSER_NAME,
        parsedAt: nowIso(),
        parseError: needsOcr
          ? `Scanned/empty conversion (${charsPerPage} chars/page < ${MIN_CHARS_PER_PAGE})`
          : null,
      })
      .where(eq(attachmentDocuments.contentHash, contentHash));

    return status;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Markdown conversion failed.";
    const attempts = row.attempts + 1;
    // Missing CF credentials will never succeed on retry — fail terminal.
    const nonRetryable =
      message.includes("CLOUDFLARE_ACCOUNT_ID") ||
      message.includes("CLOUDFLARE_API_TOKEN");
    const giveUp =
      nonRetryable || attempts >= ATTACHMENT_PARSE_MAX_ATTEMPTS;

    await db
      .update(attachmentDocuments)
      .set({
        parseStatus: giveUp ? "failed" : "pending",
        parseError: message,
      })
      .where(eq(attachmentDocuments.contentHash, contentHash));

    if (giveUp) return "failed";
    throw error;
  }
}

export async function getAttachmentParseStatus(): Promise<AttachmentParseStatusSummary> {
  const db = getDb();
  const rows = await db
    .select({
      parseStatus: attachmentDocuments.parseStatus,
      n: count(),
    })
    .from(attachmentDocuments)
    .groupBy(attachmentDocuments.parseStatus);

  const summary: AttachmentParseStatusSummary = {
    pending: 0,
    parsing: 0,
    parsed: 0,
    needsOcr: 0,
    unsupported: 0,
    failed: 0,
    total: 0,
  };

  for (const row of rows) {
    const n = Number(row.n) || 0;
    summary.total += n;
    switch (row.parseStatus) {
      case "pending":
        summary.pending = n;
        break;
      case "parsing":
        summary.parsing = n;
        break;
      case "parsed":
        summary.parsed = n;
        break;
      case "needs_ocr":
        summary.needsOcr = n;
        break;
      case "unsupported":
        summary.unsupported = n;
        break;
      case "failed":
        summary.failed = n;
        break;
      default:
        break;
    }
  }

  return summary;
}

/**
 * Ensure attachment_documents rows exist for every cached convertible hash,
 * then convert a batch of pending ones.
 */
export async function parsePendingAttachmentBatch(
  batchSize = ATTACHMENT_PARSE_BATCH_SIZE,
): Promise<AttachmentParseBatchResult> {
  await reclaimStaleParsingAttachmentDocuments();
  await seedPendingAttachmentDocuments();

  const db = getDb();
  // Soft failures stay `pending` until attempts are exhausted; only poll pending.
  const pending = await db
    .select({ contentHash: attachmentDocuments.contentHash })
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.parseStatus, "pending"))
    .limit(batchSize);

  let parsed = 0;
  let needsOcr = 0;
  let unsupported = 0;
  let failed = 0;
  let skipped = 0;
  let lastError: string | null = null;

  for (const row of pending) {
    try {
      const status = await parseAttachmentDocument(row.contentHash);
      if (status === "parsed") parsed += 1;
      else if (status === "needs_ocr") needsOcr += 1;
      else if (status === "unsupported") unsupported += 1;
      else if (status === "failed") failed += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      lastError =
        error instanceof Error ? error.message : "Markdown conversion failed.";
      console.error("[attachment-markdown]", row.contentHash, lastError);
    }
  }

  const status = await getAttachmentParseStatus();
  const remaining = status.pending + status.parsing;

  return {
    processed: pending.length,
    parsed,
    needsOcr,
    unsupported,
    failed,
    skipped,
    remaining,
    lastError,
  };
}

/**
 * Create pending/unsupported rows for cached attachments that have none yet.
 */
export async function seedPendingAttachmentDocuments(): Promise<number> {
  const db = getDb();
  const missing = await db
    .select({
      contentHash: emailAttachments.contentHash,
      mimeType: emailAttachments.mimeType,
      cachedFilePath: emailAttachments.cachedFilePath,
      pageCount: emailAttachments.pageCount,
      hasValue: emailAttachments.hasValue,
    })
    .from(emailAttachments)
    .leftJoin(
      attachmentDocuments,
      eq(emailAttachments.contentHash, attachmentDocuments.contentHash),
    )
    .where(
      and(
        sql`${emailAttachments.contentHash} is not null`,
        isNull(attachmentDocuments.contentHash),
        // Skip known decorative attachments.
        or(
          isNull(emailAttachments.hasValue),
          eq(emailAttachments.hasValue, true),
        ),
      ),
    )
    .limit(500);

  let inserted = 0;
  const seen = new Set<string>();

  for (const row of missing) {
    if (!row.contentHash || seen.has(row.contentHash)) continue;
    seen.add(row.contentHash);

    const resolvedExt = row.cachedFilePath
      ? extensionFromCachedPath(row.cachedFilePath)
      : ".bin";

    await upsertAttachmentDocumentPending({
      contentHash: row.contentHash,
      mimeType: row.mimeType,
      ext: resolvedExt,
      pageCount: row.pageCount,
      hasValue: row.hasValue,
    });
    await enrollImageAttachmentForVision({
      contentHash: row.contentHash,
      mimeType: row.mimeType,
      ext: resolvedExt,
      hasValue: row.hasValue,
    });
    inserted += 1;
  }

  return inserted;
}
