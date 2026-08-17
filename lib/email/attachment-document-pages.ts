/**
 * Persistence helpers for attachment_document_pages (pdfjs page profiles).
 */

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { attachmentDocumentPages } from "@/lib/db/schema";
import {
  PAGE_PROFILER_VERSION,
  type PageProfile,
  type PageRoute,
} from "@/lib/pdf/page-profile";

function nowIso(): string {
  return new Date().toISOString();
}

function visionStatusForRoute(
  route: PageRoute,
): "not_needed" | "pending" {
  return route === "text" ? "not_needed" : "pending";
}

/** Replace all page profile rows for a content hash with a fresh profile run. */
export async function upsertAttachmentDocumentPages(
  contentHash: string,
  profiles: PageProfile[],
  profilerVersion = PAGE_PROFILER_VERSION,
): Promise<void> {
  const db = getDb();
  const profiledAt = nowIso();

  await db
    .delete(attachmentDocumentPages)
    .where(eq(attachmentDocumentPages.contentHash, contentHash));

  if (profiles.length === 0) return;

  await db.insert(attachmentDocumentPages).values(
    profiles.map((p) => ({
      contentHash,
      pageNo: p.pageNo,
      chars: p.chars,
      textAreaRatio: String(p.textAreaRatio),
      imageAreaRatio: String(p.imageAreaRatio),
      vectorOps: p.vectorOps,
      hasTextLayer: p.hasTextLayer,
      route: p.route,
      visionStatus: visionStatusForRoute(p.route),
      artifactPath: null,
      profilerVersion,
      profiledAt,
    })),
  );
}

export async function listAttachmentDocumentPages(contentHash: string) {
  const db = getDb();
  return db
    .select()
    .from(attachmentDocumentPages)
    .where(eq(attachmentDocumentPages.contentHash, contentHash));
}
