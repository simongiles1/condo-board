/**
 * Persist PDF Info + header/footer text on attachment_documents.
 */

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { attachmentDocuments } from "@/lib/db/schema";
import { readCachedAttachment } from "@/lib/gmail/attachments";
import {
  extractPdfFileMetadata,
  isPdfAttachment,
  type PdfFileMetadata,
} from "@/lib/pdf/document-properties";

export type StoredFileMetadata = PdfFileMetadata;

export function parseStoredFileMetadata(
  raw: string | null | undefined,
): StoredFileMetadata | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFileMetadata>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.extractedAt !== "string" || !parsed.extractedAt) {
      return null;
    }
    return {
      title: typeof parsed.title === "string" ? parsed.title : null,
      author: typeof parsed.author === "string" ? parsed.author : null,
      subject: typeof parsed.subject === "string" ? parsed.subject : null,
      keywords: typeof parsed.keywords === "string" ? parsed.keywords : null,
      creator: typeof parsed.creator === "string" ? parsed.creator : null,
      producer: typeof parsed.producer === "string" ? parsed.producer : null,
      creationDate:
        typeof parsed.creationDate === "string" ? parsed.creationDate : null,
      modificationDate:
        typeof parsed.modificationDate === "string"
          ? parsed.modificationDate
          : null,
      pageCount:
        typeof parsed.pageCount === "number" ? parsed.pageCount : null,
      headerText: typeof parsed.headerText === "string" ? parsed.headerText : null,
      footerText: typeof parsed.footerText === "string" ? parsed.footerText : null,
      extractedAt: parsed.extractedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Extract and store PDF properties when missing. No-op for non-PDFs.
 */
export async function ensureAttachmentFileMetadata(params: {
  contentHash: string;
  mimeType: string;
  ext: string;
  bytes?: Buffer | null;
  existingJson?: string | null;
}): Promise<StoredFileMetadata | null> {
  const existing = parseStoredFileMetadata(params.existingJson);
  if (existing) return existing;

  if (!isPdfAttachment(params.mimeType, params.ext)) return null;

  let bytes = params.bytes ?? null;
  if (!bytes) {
    bytes = await readCachedAttachment(params.contentHash, params.ext);
  }
  if (!bytes && params.ext !== ".pdf") {
    bytes = await readCachedAttachment(params.contentHash, ".pdf");
  }
  if (!bytes) return null;

  try {
    const meta = await extractPdfFileMetadata(bytes);
    const db = getDb();
    await db
      .update(attachmentDocuments)
      .set({ fileMetadataJson: JSON.stringify(meta) })
      .where(eq(attachmentDocuments.contentHash, params.contentHash));
    return meta;
  } catch (error) {
    console.warn(
      `[attachment-file-metadata] extract failed for ${params.contentHash}:`,
      error,
    );
    return null;
  }
}
