/**
 * Enroll cached image attachments as synthetic 1-page vision documents.
 *
 * Images skip Cloudflare toMarkdown; page vision is the transcription path.
 */

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentDocumentPages,
  attachmentDocuments,
} from "@/lib/db/schema";
import {
  IMAGE_VISION_PROFILER_VERSION,
  isVisionImageExt,
  isVisionImageMime,
  normalizeVisionImageMime,
  visionImageMimeFromExt,
} from "@/lib/email/attachment-vision-image-shared";

function nowIso(): string {
  return new Date().toISOString();
}

export type ImageVisionEnrollResult = "enrolled" | "already" | "skipped";

/**
 * Ensure attachment_documents + a single vision-pending page row for an image.
 * Idempotent: never wipes done/processing vision progress.
 */
export async function enrollImageAttachmentForVision(input: {
  contentHash: string;
  mimeType: string;
  ext: string;
  hasValue?: boolean | null;
}): Promise<ImageVisionEnrollResult> {
  if (input.hasValue === false) return "skipped";

  const fromMime = isVisionImageMime(input.mimeType)
    ? normalizeVisionImageMime(input.mimeType)
    : null;
  const fromExt = visionImageMimeFromExt(input.ext);
  const resolvedMime = fromMime ?? fromExt;
  if (!resolvedMime) return "skipped";

  const contentHash = input.contentHash.toLowerCase();
  let ext = input.ext.startsWith(".")
    ? input.ext.toLowerCase()
    : `.${input.ext.toLowerCase()}`;
  if (ext === ".bin" || !isVisionImageExt(ext)) {
    const mimeExt =
      resolvedMime === "image/png"
        ? ".png"
        : resolvedMime === "image/jpeg"
          ? ".jpg"
          : resolvedMime === "image/gif"
            ? ".gif"
            : resolvedMime === "image/webp"
              ? ".webp"
              : null;
    if (mimeExt) ext = mimeExt;
  }
  const db = getDb();
  const seenAt = nowIso();

  const [existing] = await db
    .select()
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, contentHash))
    .limit(1);

  if (!existing) {
    await db.insert(attachmentDocuments).values({
      contentHash,
      mimeType: resolvedMime,
      ext,
      parseStatus: "needs_ocr",
      parseError: null,
      pageCount: 1,
      sizeClass: "short",
      attempts: 0,
      firstSeenAt: seenAt,
    });
  } else {
    const patch: {
      mimeType?: string;
      ext?: string;
      pageCount?: number;
      parseStatus?: "needs_ocr";
      sizeClass?: "short";
    } = {};

    if (!isVisionImageMime(existing.mimeType)) {
      patch.mimeType = resolvedMime;
    }
    if (!existing.ext || existing.ext === ".bin") {
      patch.ext = ext;
    }
    if (existing.pageCount == null || existing.pageCount < 1) {
      patch.pageCount = 1;
    }
    // Images never go through CF toMarkdown — keep them on the OCR/vision path.
    if (
      existing.parseStatus === "pending" ||
      existing.parseStatus === "unsupported" ||
      existing.parseStatus === "failed"
    ) {
      patch.parseStatus = "needs_ocr";
      patch.sizeClass = "short";
    }

    if (Object.keys(patch).length > 0) {
      await db
        .update(attachmentDocuments)
        .set(patch)
        .where(eq(attachmentDocuments.contentHash, contentHash));
    }
  }

  const [page] = await db
    .select({
      pageNo: attachmentDocumentPages.pageNo,
      route: attachmentDocumentPages.route,
      visionStatus: attachmentDocumentPages.visionStatus,
      profilerVersion: attachmentDocumentPages.profilerVersion,
    })
    .from(attachmentDocumentPages)
    .where(
      and(
        eq(attachmentDocumentPages.contentHash, contentHash),
        eq(attachmentDocumentPages.pageNo, 1),
      ),
    )
    .limit(1);

  if (page) {
    // Preserve in-flight / completed vision; only repair mis-routed rows.
    if (
      page.route !== "vision" &&
      (page.visionStatus === "not_needed" || page.visionStatus === "skipped")
    ) {
      await db
        .update(attachmentDocumentPages)
        .set({
          route: "vision",
          visionStatus: "pending",
          visionError: null,
          profilerVersion: IMAGE_VISION_PROFILER_VERSION,
          profiledAt: seenAt,
        })
        .where(
          and(
            eq(attachmentDocumentPages.contentHash, contentHash),
            eq(attachmentDocumentPages.pageNo, 1),
          ),
        );
      return "enrolled";
    }
    return "already";
  }

  await db.insert(attachmentDocumentPages).values({
    contentHash,
    pageNo: 1,
    chars: 0,
    textAreaRatio: "0",
    imageAreaRatio: "1",
    vectorOps: 0,
    hasTextLayer: false,
    route: "vision",
    visionStatus: "pending",
    artifactPath: null,
    profilerVersion: IMAGE_VISION_PROFILER_VERSION,
    profiledAt: seenAt,
  });

  return "enrolled";
}
