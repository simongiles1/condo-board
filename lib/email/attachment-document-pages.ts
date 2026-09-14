/**
 * Persistence helpers for attachment_document_pages (pdfjs page profiles).
 */

import { eq } from "drizzle-orm";
import { access, readFile } from "fs/promises";
import path from "path";

import { getDb } from "@/lib/db";
import {
  attachmentDocumentPages,
  attachmentDocuments,
} from "@/lib/db/schema";
import {
  PAGE_PROFILER_VERSION,
  profilePdfPages,
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

export type EnsureAttachmentPageProfileResult =
  | { status: "already"; pages: number }
  | { status: "profiled"; pages: number }
  | { status: "skipped"; reason: "not_pdf" | "missing_bytes" | "not_found" }
  | { status: "failed"; error: string };

function isPdfDocument(
  mimeType: string | null | undefined,
  ext: string | null | undefined,
): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  const normalizedExt = (ext ?? "").toLowerCase().replace(/^\./, "");
  return mime.includes("pdf") || normalizedExt === "pdf";
}

async function resolveCachedPdfPath(
  contentHash: string,
  ext: string | null,
): Promise<string | null> {
  const normalizedExt = ext?.trim()
    ? ext.startsWith(".")
      ? ext
      : `.${ext}`
    : null;
  const candidates = [
    normalizedExt
      ? path.join(
          process.cwd(),
          "data",
          "email-attachments",
          `${contentHash}${normalizedExt}`,
        )
      : null,
    path.join(process.cwd(), "data", "email-attachments", `${contentHash}.pdf`),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Create page-route rows for a downloaded PDF when ingest/Docling need them.
 * Docling only converts pages that already exist in this table; without this
 * step a hashed file is counted "complete" and never reaches parse_status=parsed.
 */
export async function ensureAttachmentPageProfile(
  contentHash: string,
): Promise<EnsureAttachmentPageProfileResult> {
  const hash = contentHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return { status: "skipped", reason: "not_found" };
  }

  const existingPages = await listAttachmentDocumentPages(hash);
  if (
    existingPages.length > 0 &&
    existingPages.every((page) => page.profilerVersion === PAGE_PROFILER_VERSION)
  ) {
    return { status: "already", pages: existingPages.length };
  }

  const db = getDb();
  const [doc] = await db
    .select({
      mimeType: attachmentDocuments.mimeType,
      ext: attachmentDocuments.ext,
    })
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, hash))
    .limit(1);

  if (!doc) {
    return { status: "skipped", reason: "not_found" };
  }
  if (!isPdfDocument(doc.mimeType, doc.ext)) {
    return { status: "skipped", reason: "not_pdf" };
  }

  const filePath = await resolveCachedPdfPath(hash, doc.ext);
  if (!filePath) {
    return { status: "skipped", reason: "missing_bytes" };
  }

  try {
    const bytes = await readFile(filePath);
    const profiles = await profilePdfPages(bytes);
    await upsertAttachmentDocumentPages(hash, profiles);
    return { status: "profiled", pages: profiles.length };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
