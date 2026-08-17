/**
 * Tier 2 page vision worker: claim pending pages → Gemini multimodal →
 * per-page artifacts → deterministic merge into attachment Markdown.
 *
 * On-demand only (API / CLI). Does not auto-start with instrumentation.
 */

import path from "path";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentDocumentPages,
  attachmentDocuments,
  emailAttachments,
} from "@/lib/db/schema";
import {
  attachmentMarkdownRelativeKey,
  resolveAttachmentStoragePath,
} from "@/lib/email/attachment-markdown-shared";
import {
  PAGE_VISION_SYSTEM_PROMPT,
  pageVisionUserText,
} from "@/lib/email/page-vision-prompt";
import {
  PAGE_VISION_PARSER_NAME,
  classifyGeminiHttpError,
  geminiBillingHaltMessage,
  isDegeneratePageVisionMarkdown,
  isFatalGeminiVisionError,
  pageVisionArtifactRelativeKey,
  pageVisionBatchSizeFromEnv,
  pageVisionMaxAttemptsFromEnv,
  pageVisionRateLimitBackoffMsFromEnv,
  pageVisionRateLimitMaxRoundsFromEnv,
  pageVisionStaleProcessingMsFromEnv,
  sanitizePageVisionMarkdown,
  spliceVisionPageIntoMarkdown,
  type GeminiBillingHaltKind,
} from "@/lib/email/page-vision-shared";
import { generatePageVision } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import { extractPdfPageText } from "@/lib/pdf/extract-page-text";
import { extractPdfPages } from "@/lib/pdf/extract-pages";
import { readCachedAttachment } from "@/lib/gmail/attachments";
import {
  readExtractArtifactText,
  writeExtractArtifactText,
} from "@/lib/storage/extract-artifacts";
import {
  isVisionImageExt,
  isVisionImageMime,
  normalizeVisionImageMime,
  visionImageMimeFromExt,
} from "@/lib/email/attachment-vision-image-shared";

function nowIso(): string {
  return new Date().toISOString();
}

function createSemaphore(limit: number) {
  let available = Math.max(1, limit);
  const waiters: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (available > 0) {
        available -= 1;
      } else {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
      try {
        return await fn();
      } finally {
        const next = waiters.shift();
        if (next) next();
        else available += 1;
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const visionPageSlot = createSemaphore(pageVisionBatchSizeFromEnv());

function attachmentMarkdownAbsolutePath(contentHash: string): string {
  return path.join(
    process.cwd(),
    "data",
    "email-attachments",
    `${contentHash}.md`,
  );
}

function resolveArtifactAbsolute(relativeKey: string): string {
  return resolveAttachmentStoragePath(relativeKey);
}

export type PageVisionPageResult = {
  contentHash: string;
  pageNo: number;
  status: "done" | "failed" | "skipped" | "requeued" | "quota" | "rate_limit";
  costUsd: number;
  error?: string;
};

export type PageVisionBillingHalt = {
  kind: GeminiBillingHaltKind;
  error: string;
};

export type PageVisionBatchResult = {
  reclaimed: number;
  processed: number;
  done: number;
  failed: number;
  skipped: number;
  mergedHashes: string[];
  costUsd: number;
  pages: PageVisionPageResult[];
  billingHalt?: PageVisionBillingHalt;
};

type ClaimedPage = {
  contentHash: string;
  pageNo: number;
  visionAttempts: number;
  ext: string | null;
  mimeType: string | null;
};

async function loadMarkdownForHash(contentHash: string): Promise<{
  markdown: string;
  markdownPath: string | null;
  parseStatus: string | null;
  pageCount: number | null;
}> {
  const db = getDb();
  const [doc] = await db
    .select({
      markdownPath: attachmentDocuments.markdownPath,
      parseStatus: attachmentDocuments.parseStatus,
      pageCount: attachmentDocuments.pageCount,
    })
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, contentHash))
    .limit(1);

  if (!doc) {
    return {
      markdown: "",
      markdownPath: null,
      parseStatus: null,
      pageCount: null,
    };
  }

  const candidates = [
    doc.markdownPath
      ? resolveAttachmentStoragePath(doc.markdownPath)
      : null,
    attachmentMarkdownAbsolutePath(contentHash),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const markdown = await readExtractArtifactText(candidate);
    if (markdown != null) {
      return {
        markdown,
        markdownPath: doc.markdownPath,
        parseStatus: doc.parseStatus,
        pageCount: doc.pageCount,
      };
    }
  }

  return {
    markdown: "",
    markdownPath: doc.markdownPath,
    parseStatus: doc.parseStatus,
    pageCount: doc.pageCount,
  };
}

/**
 * Crash recovery: reclaim stale `processing` rows (or all processing if no
 * visioned_at timestamp yet).
 */
export async function reclaimStaleProcessingVisionPages(): Promise<number> {
  const db = getDb();
  const maxAttempts = pageVisionMaxAttemptsFromEnv();
  const staleMs = pageVisionStaleProcessingMsFromEnv();
  const cutoffIso = new Date(Date.now() - staleMs).toISOString();

  const stuck = await db
    .select({
      contentHash: attachmentDocumentPages.contentHash,
      pageNo: attachmentDocumentPages.pageNo,
      visionAttempts: attachmentDocumentPages.visionAttempts,
      visionedAt: attachmentDocumentPages.visionedAt,
    })
    .from(attachmentDocumentPages)
    .where(eq(attachmentDocumentPages.visionStatus, "processing"));

  let reclaimed = 0;
  for (const row of stuck) {
    const isStale =
      !row.visionedAt || row.visionedAt <= cutoffIso;
    if (!isStale) continue;

    const giveUp = row.visionAttempts >= maxAttempts;
    await db
      .update(attachmentDocumentPages)
      .set({
        visionStatus: giveUp ? "failed" : "pending",
        visionError: giveUp
          ? "Interrupted while processing (stale) — max attempts reached."
          : "Interrupted while processing (stale) — requeued.",
      })
      .where(
        and(
          eq(attachmentDocumentPages.contentHash, row.contentHash),
          eq(attachmentDocumentPages.pageNo, row.pageNo),
        ),
      );
    reclaimed += 1;
  }
  return reclaimed;
}

async function claimPendingVisionPages(
  batchSize: number,
  onlyHash?: string,
  onlyPageNos?: number[],
): Promise<ClaimedPage[]> {
  const db = getDb();

  const conditions = [eq(attachmentDocumentPages.visionStatus, "pending")];
  if (onlyHash) {
    conditions.push(eq(attachmentDocumentPages.contentHash, onlyHash));
  }
  if (onlyPageNos && onlyPageNos.length > 0) {
    conditions.push(inArray(attachmentDocumentPages.pageNo, onlyPageNos));
  }

  const pending = await db
    .select({
      contentHash: attachmentDocumentPages.contentHash,
      pageNo: attachmentDocumentPages.pageNo,
      visionAttempts: attachmentDocumentPages.visionAttempts,
      ext: attachmentDocuments.ext,
      mimeType: attachmentDocuments.mimeType,
    })
    .from(attachmentDocumentPages)
    .leftJoin(
      attachmentDocuments,
      eq(
        attachmentDocumentPages.contentHash,
        attachmentDocuments.contentHash,
      ),
    )
    .where(and(...conditions))
    .orderBy(
      asc(attachmentDocumentPages.contentHash),
      asc(attachmentDocumentPages.pageNo),
    )
    .limit(batchSize);

  const claimed: ClaimedPage[] = [];
  const claimedAt = nowIso();

  for (const row of pending) {
    const nextAttempts = row.visionAttempts + 1;
    const updated = await db
      .update(attachmentDocumentPages)
      .set({
        visionStatus: "processing",
        visionAttempts: nextAttempts,
        visionError: null,
        visionedAt: claimedAt,
      })
      .where(
        and(
          eq(attachmentDocumentPages.contentHash, row.contentHash),
          eq(attachmentDocumentPages.pageNo, row.pageNo),
          eq(attachmentDocumentPages.visionStatus, "pending"),
        ),
      )
      .returning({
        contentHash: attachmentDocumentPages.contentHash,
        pageNo: attachmentDocumentPages.pageNo,
      });

    if (updated.length === 0) continue;

    claimed.push({
      contentHash: row.contentHash,
      pageNo: row.pageNo,
      visionAttempts: nextAttempts,
      ext: row.ext,
      mimeType: row.mimeType,
    });
  }

  return claimed;
}

async function resolveCachedBytes(
  contentHash: string,
  ext: string | null,
  mimeType: string | null,
): Promise<Buffer> {
  const image =
    (mimeType != null && isVisionImageMime(mimeType)) ||
    isVisionImageExt(ext);
  const extCandidates = [
    ext,
    ...(image ? [".png", ".jpg", ".jpeg", ".gif", ".webp"] : [".pdf"]),
  ].filter((e, i, arr): e is string => Boolean(e) && arr.indexOf(e) === i);

  for (const candidate of extCandidates) {
    const bytes = await readCachedAttachment(contentHash, candidate);
    if (bytes) return bytes;
  }

  // Fall back to any email_attachments cached path for this hash.
  const db = getDb();
  const [attachment] = await db
    .select({
      cachedFilePath: emailAttachments.cachedFilePath,
    })
    .from(emailAttachments)
    .where(eq(emailAttachments.contentHash, contentHash))
    .limit(1);

  if (attachment?.cachedFilePath) {
    const fileExt =
      attachment.cachedFilePath.match(/\.[^.]+$/)?.[0] ??
      (image ? ".png" : ".pdf");
    const bytes = await readCachedAttachment(contentHash, fileExt);
    if (bytes) return bytes;
  }

  throw new Error(
    `Cached ${image ? "image" : "PDF"} bytes missing for ${contentHash}`,
  );
}

function resolvePageVisionFilePart(
  page: ClaimedPage,
  bytes: Buffer,
  pagePdf: Uint8Array | null,
): { mimeType: string; data: Buffer; label: string; kind: "pdf" | "image" } {
  const mime = page.mimeType ?? "";
  if (isVisionImageMime(mime) || isVisionImageExt(page.ext)) {
    const imageMime =
      (isVisionImageMime(mime) ? normalizeVisionImageMime(mime) : null) ??
      visionImageMimeFromExt(page.ext) ??
      "image/jpeg";
    const ext =
      page.ext && isVisionImageExt(page.ext)
        ? page.ext
        : `.${imageMime.split("/")[1] ?? "jpg"}`;
    return {
      mimeType: imageMime,
      data: bytes,
      label: `page-${page.pageNo}${ext}`,
      kind: "image",
    };
  }

  if (!pagePdf) {
    throw new Error("PDF page slice missing.");
  }

  return {
    mimeType: "application/pdf",
    data: Buffer.from(pagePdf),
    label: `page-${page.pageNo}.pdf`,
    kind: "pdf",
  };
}

async function processClaimedPage(
  page: ClaimedPage,
): Promise<PageVisionPageResult> {
  const db = getDb();
  const maxAttempts = pageVisionMaxAttemptsFromEnv();

  try {
    const isImage =
      (page.mimeType != null && isVisionImageMime(page.mimeType)) ||
      isVisionImageExt(page.ext);
    const isPdf =
      !isImage &&
      (page.mimeType == null ||
        page.mimeType.toLowerCase().includes("pdf") ||
        (page.ext?.toLowerCase() ?? "") === ".pdf");

    if (!isImage && !isPdf) {
      await db
        .update(attachmentDocumentPages)
        .set({
          visionStatus: "skipped",
          visionError: `MIME type not supported for page vision: ${page.mimeType ?? "unknown"}`,
          visionedAt: nowIso(),
        })
        .where(
          and(
            eq(attachmentDocumentPages.contentHash, page.contentHash),
            eq(attachmentDocumentPages.pageNo, page.pageNo),
          ),
        );
      return {
        contentHash: page.contentHash,
        pageNo: page.pageNo,
        status: "skipped",
        costUsd: 0,
        error: page.mimeType ?? "unknown",
      };
    }

    const bytes = await resolveCachedBytes(
      page.contentHash,
      page.ext,
      page.mimeType,
    );

    let pagePdf: Uint8Array | null = null;
    let nativeText = "";
    if (isPdf) {
      pagePdf = await extractPdfPages(bytes, [page.pageNo]);
      try {
        nativeText = await extractPdfPageText(bytes, page.pageNo);
      } catch {
        // Vision can still run without selectable text.
      }
    }

    const filePart = resolvePageVisionFilePart(page, bytes, pagePdf);

    const result = await generatePageVision({
      systemInstruction: PAGE_VISION_SYSTEM_PROMPT,
      userText: pageVisionUserText(page.pageNo, nativeText, {
        kind: filePart.kind,
      }),
      fileParts: [
        {
          mimeType: filePart.mimeType,
          data: filePart.data,
          label: filePart.label,
        },
      ],
    });

    const costUsd = estimateCostUsd(result.modelName, result.usage);
    const usagePatch = {
      visionModel: result.modelName,
      visionInputTokens: result.usage.inputTokens,
      visionOutputTokens: result.usage.outputTokens,
      visionCostUsd: String(costUsd),
    };

    const invalidReason = result.truncated
      ? "Vision output truncated (max tokens) — requeued for retry."
      : isDegeneratePageVisionMarkdown(result.text)
        ? "Vision output degenerate (dash runaway) — requeued for retry."
        : null;
    if (invalidReason) {
      // Google already billed this call — keep cost even though the page
      // is not usable yet.
      const giveUp = page.visionAttempts >= maxAttempts;
      await db
        .update(attachmentDocumentPages)
        .set({
          visionStatus: giveUp ? "failed" : "pending",
          visionError: invalidReason,
          visionedAt: nowIso(),
          ...usagePatch,
        })
        .where(
          and(
            eq(attachmentDocumentPages.contentHash, page.contentHash),
            eq(attachmentDocumentPages.pageNo, page.pageNo),
          ),
        );
      return {
        contentHash: page.contentHash,
        pageNo: page.pageNo,
        status: giveUp ? "failed" : "requeued",
        costUsd,
        error: invalidReason,
      };
    }

    const relativeKey = pageVisionArtifactRelativeKey(
      page.contentHash,
      page.pageNo,
    );
    const absolute = resolveArtifactAbsolute(relativeKey);
    const artifactBody = sanitizePageVisionMarkdown(result.text).trim();
    await writeExtractArtifactText(absolute, artifactBody + "\n");

    await db
      .update(attachmentDocumentPages)
      .set({
        visionStatus: "done",
        artifactPath: relativeKey,
        visionError: null,
        visionedAt: nowIso(),
        ...usagePatch,
      })
      .where(
        and(
          eq(attachmentDocumentPages.contentHash, page.contentHash),
          eq(attachmentDocumentPages.pageNo, page.pageNo),
        ),
      );

    return {
      contentHash: page.contentHash,
      pageNo: page.pageNo,
      status: "done",
      costUsd,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Page vision failed.";
    const http = classifyGeminiHttpError(message);
    const quota = http?.fatal === true || isFatalGeminiVisionError(error);

    if (quota || http?.kind === "gemini_rate_limit") {
      // Billing halt and RPM are not page defects — leave pending and undo
      // the claim bump so a later retry still has full attempts.
      await db
        .update(attachmentDocumentPages)
        .set({
          visionStatus: "pending",
          visionAttempts: Math.max(0, page.visionAttempts - 1),
          visionError: message,
          visionedAt: nowIso(),
        })
        .where(
          and(
            eq(attachmentDocumentPages.contentHash, page.contentHash),
            eq(attachmentDocumentPages.pageNo, page.pageNo),
          ),
        );
      return {
        contentHash: page.contentHash,
        pageNo: page.pageNo,
        status: quota ? "quota" : "rate_limit",
        costUsd: 0,
        error: message,
      };
    }

    const giveUp = page.visionAttempts >= maxAttempts;

    await db
      .update(attachmentDocumentPages)
      .set({
        visionStatus: giveUp ? "failed" : "pending",
        visionError: message,
        visionedAt: nowIso(),
      })
      .where(
        and(
          eq(attachmentDocumentPages.contentHash, page.contentHash),
          eq(attachmentDocumentPages.pageNo, page.pageNo),
        ),
      );

    return {
      contentHash: page.contentHash,
      pageNo: page.pageNo,
      status: giveUp ? "failed" : "requeued",
      costUsd: 0,
      error: message,
    };
  }
}

/**
 * When a content hash has no pending/processing pages, splice done artifacts
 * into the attachment `.md` and flip `needs_ocr` → `parsed` when appropriate.
 */
export async function mergeVisionArtifactsForHash(
  contentHash: string,
): Promise<boolean> {
  const db = getDb();

  const [inflight] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachmentDocumentPages)
    .where(
      and(
        eq(attachmentDocumentPages.contentHash, contentHash),
        inArray(attachmentDocumentPages.visionStatus, [
          "pending",
          "processing",
        ]),
      ),
    );

  if ((inflight?.count ?? 0) > 0) {
    return false;
  }

  const donePages = await db
    .select({
      pageNo: attachmentDocumentPages.pageNo,
      artifactPath: attachmentDocumentPages.artifactPath,
    })
    .from(attachmentDocumentPages)
    .where(
      and(
        eq(attachmentDocumentPages.contentHash, contentHash),
        eq(attachmentDocumentPages.visionStatus, "done"),
      ),
    )
    .orderBy(asc(attachmentDocumentPages.pageNo));

  if (donePages.length === 0) {
    return false;
  }

  const loaded = await loadMarkdownForHash(contentHash);
  let markdown = loaded.markdown;

  for (const page of donePages) {
    if (!page.artifactPath) continue;
    const body = await readExtractArtifactText(
      resolveArtifactAbsolute(page.artifactPath),
    );
    if (body == null) {
      console.warn(
        `[page-vision] missing artifact for ${contentHash} p${page.pageNo}`,
      );
      continue;
    }
    markdown = spliceVisionPageIntoMarkdown(markdown, page.pageNo, body);
  }

  const mdKey = attachmentMarkdownRelativeKey(contentHash);
  const mdAbsolute = attachmentMarkdownAbsolutePath(contentHash);
  await writeExtractArtifactText(mdAbsolute, markdown);

  const markdownChars = markdown.length;
  const pageCount = loaded.pageCount;
  const charsPerPage =
    pageCount != null && pageCount > 0
      ? Math.round(markdownChars / pageCount)
      : null;

  const flipNeedsOcr = loaded.parseStatus === "needs_ocr";

  await db
    .update(attachmentDocuments)
    .set({
      markdownPath: mdKey,
      markdownChars,
      charsPerPage,
      parserName: PAGE_VISION_PARSER_NAME,
      parseError: null,
      ...(flipNeedsOcr
        ? { parseStatus: "parsed" as const, parsedAt: nowIso() }
        : {}),
    })
    .where(eq(attachmentDocuments.contentHash, contentHash));

  return true;
}

/**
 * Process one batch of pending vision pages (serial).
 */
export async function processPendingVisionBatch(options?: {
  batchSize?: number;
  contentHash?: string;
  dryRun?: boolean;
}): Promise<PageVisionBatchResult> {
  const batchSize = options?.batchSize ?? pageVisionBatchSizeFromEnv();
  const reclaimed = await reclaimStaleProcessingVisionPages();

  if (options?.dryRun) {
    const db = getDb();
    const conditions = [eq(attachmentDocumentPages.visionStatus, "pending")];
    if (options.contentHash) {
      conditions.push(
        eq(attachmentDocumentPages.contentHash, options.contentHash),
      );
    }
    const pending = await db
      .select({
        contentHash: attachmentDocumentPages.contentHash,
        pageNo: attachmentDocumentPages.pageNo,
      })
      .from(attachmentDocumentPages)
      .where(and(...conditions))
      .orderBy(
        asc(attachmentDocumentPages.contentHash),
        asc(attachmentDocumentPages.pageNo),
      )
      .limit(batchSize);

    return {
      reclaimed,
      processed: pending.length,
      done: 0,
      failed: 0,
      skipped: pending.length,
      mergedHashes: [],
      costUsd: 0,
      pages: pending.map((p) => ({
        contentHash: p.contentHash,
        pageNo: p.pageNo,
        status: "skipped" as const,
        costUsd: 0,
        error: "dry-run",
      })),
    };
  }

  const claimed = await claimPendingVisionPages(
    batchSize,
    options?.contentHash,
  );

  const pages: PageVisionPageResult[] = [];
  let done = 0;
  let failed = 0;
  let skipped = 0;
  let costUsd = 0;
  const touchedHashes = new Set<string>();

  const batchResults = await Promise.all(
    claimed.map((page) => visionPageSlot.run(() => processClaimedPage(page))),
  );
  for (const result of batchResults) {
    pages.push(result);
    touchedHashes.add(result.contentHash);
    costUsd += result.costUsd;
    if (result.status === "done") done += 1;
    else if (result.status === "skipped") skipped += 1;
    else if (result.status === "failed") failed += 1;
  }

  const mergedHashes: string[] = [];
  for (const hash of touchedHashes) {
    const merged = await mergeVisionArtifactsForHash(hash);
    if (merged) mergedHashes.push(hash);
  }

  return {
    reclaimed,
    processed: claimed.length,
    done,
    failed,
    skipped,
    mergedHashes,
    costUsd,
    pages,
  };
}

/**
 * Process all pending vision pages for one document (UI-friendly).
 * Optionally requeue specific pages first (force re-run).
 */
export async function processVisionForDocument(options: {
  contentHash: string;
  pageNos?: number[];
  /** When true (default if pageNos set), reset those pages to pending first. */
  force?: boolean;
  maxPages?: number;
}): Promise<PageVisionBatchResult> {
  const contentHash = options.contentHash.trim().toLowerCase();
  const pageNos = options.pageNos?.filter(
    (n) => Number.isInteger(n) && n >= 1,
  );
  const force = options.force ?? Boolean(pageNos && pageNos.length > 0);
  const maxPages = options.maxPages ?? 100;

  if (force && pageNos && pageNos.length > 0) {
    const { requeueVisionPages } = await import("@/lib/email/page-vision-lab");
    await requeueVisionPages(contentHash, pageNos);
  }

  await reclaimStaleProcessingVisionPages();

  const pages: PageVisionPageResult[] = [];
  let done = 0;
  let failed = 0;
  let skipped = 0;
  let costUsd = 0;
  let remaining = maxPages;
  let merged = false;
  let billingHalt: PageVisionBillingHalt | undefined;
  let rateLimitRounds = 0;
  const rateLimitBackoffMs = pageVisionRateLimitBackoffMsFromEnv();
  const rateLimitMaxRounds = pageVisionRateLimitMaxRoundsFromEnv();

  while (remaining > 0) {
    const batchSize = Math.min(pageVisionBatchSizeFromEnv(), remaining);
    const claimed = await claimPendingVisionPages(
      batchSize,
      contentHash,
      pageNos,
    );
    if (claimed.length === 0) break;

    const batchResults = await Promise.all(
      claimed.map((page) => visionPageSlot.run(() => processClaimedPage(page))),
    );
    for (const result of batchResults) {
      pages.push(result);
      costUsd += result.costUsd;
      if (result.status === "done") done += 1;
      else if (result.status === "skipped") skipped += 1;
      else if (result.status === "failed") failed += 1;
    }

    const quotaHit = batchResults.find((item) => item.status === "quota");
    if (quotaHit) {
      const http = classifyGeminiHttpError(quotaHit.error ?? "");
      const kind: GeminiBillingHaltKind =
        http?.kind === "gemini_credits" ? "gemini_credits" : "gemini_spend_cap";
      billingHalt = {
        kind,
        error: quotaHit.error || geminiBillingHaltMessage(kind),
      };
      break;
    }

    const rateHit = batchResults.some((item) => item.status === "rate_limit");
    if (rateHit) {
      rateLimitRounds += 1;
      if (rateLimitRounds >= rateLimitMaxRounds) break;
      await sleep(rateLimitBackoffMs);
      continue;
    }

    remaining -= claimed.length;
  }

  merged = await mergeVisionArtifactsForHash(contentHash);

  return {
    reclaimed: 0,
    processed: pages.length,
    done,
    failed,
    skipped,
    mergedHashes: merged ? [contentHash] : [],
    costUsd,
    pages,
    billingHalt,
  };
}
