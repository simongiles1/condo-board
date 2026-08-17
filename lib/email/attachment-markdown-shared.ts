/**
 * Pure helpers for attachment Markdown conversion (safe to import in unit tests).
 */

import path from "path";

/** Below this chars/page on a multi-page PDF → treat as scanned / needs OCR. */
export const MIN_CHARS_PER_PAGE = 150;

/** Page-based size class for extraction triage (P1 consumes this). */
export const SHORT_DOC_MAX_PAGES = 9;

export const PARSER_NAME = "cf-tomarkdown";
export const DOCLING_PARSER_NAME = "docling";
export const DOCLING_VISION_PARSER_NAME = "docling+gemini-vision";

export const ATTACHMENT_PARSE_BATCH_SIZE = 4;
export const ATTACHMENT_PARSE_MAX_ATTEMPTS = 3;

/** Relative key under process.cwd() — survives container path moves. */
export function attachmentMarkdownRelativeKey(contentHash: string): string {
  return path.posix.join("data", "email-attachments", `${contentHash}.md`);
}

/**
 * Resolve a stored markdown path (relative preferred; absolute legacy tolerated).
 */
export function resolveAttachmentStoragePath(storedPath: string): string {
  const trimmed = storedPath.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.join(process.cwd(), trimmed);
}

const CONVERTIBLE_MIME_PREFIXES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet",
  "application/vnd.oasis.opendocument",
  "text/csv",
  "text/html",
  "application/xml",
  "text/xml",
] as const;

export type AttachmentParseStatus =
  | "pending"
  | "parsing"
  | "parsed"
  | "unsupported"
  | "failed"
  | "needs_ocr";

export function isConvertibleMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!mime) return false;
  // Images use Workers AI models (cost); OCR fallback is P1 Gemini vision.
  if (mime.startsWith("image/")) return false;
  return CONVERTIBLE_MIME_PREFIXES.some(
    (prefix) => mime === prefix || mime.startsWith(prefix),
  );
}

export function classifySizeClass(
  pageCount: number | null | undefined,
  markdownChars: number | null | undefined,
): "short" | "long" {
  if (pageCount != null && pageCount > 0) {
    return pageCount > SHORT_DOC_MAX_PAGES ? "long" : "short";
  }
  // Fallback when pages unknown (xlsx/docx): ~40k chars ≈ long contract body.
  if (markdownChars != null && markdownChars > 40_000) return "long";
  return "short";
}

export function extensionFromCachedPath(cachedFilePath: string): string {
  return cachedFilePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".bin";
}

/**
 * True when extraction work is complete enough to move the lab card off
 * Needs work. Docling/vision backfill used to leave PDFs `pending` because
 * only Cloudflare toMarkdown and `needs_ocr`→vision wrote `parsed`.
 */
export function canMarkExtractionParsed(input: {
  parseStatus: string | null | undefined;
  pendingVision: number;
  processingVision: number;
  failedVision: number;
  hasUsableMarkdown: boolean;
  uncachedTextPages: number;
}): boolean {
  if (!input.hasUsableMarkdown) return false;
  if (input.uncachedTextPages > 0) return false;
  if (
    input.pendingVision > 0 ||
    input.processingVision > 0 ||
    input.failedVision > 0
  ) {
    return false;
  }
  return (
    input.parseStatus === "pending" ||
    input.parseStatus === "parsing" ||
    input.parseStatus === "needs_ocr"
  );
}

export function shouldFlagNeedsOcr(input: {
  pageCount: number | null | undefined;
  markdownChars: number;
}): { needsOcr: boolean; charsPerPage: number | null } {
  const { pageCount, markdownChars } = input;
  const charsPerPage =
    pageCount != null && pageCount > 0
      ? Math.round(markdownChars / pageCount)
      : null;
  const needsOcr =
    pageCount != null &&
    pageCount >= 2 &&
    charsPerPage != null &&
    charsPerPage < MIN_CHARS_PER_PAGE;
  return { needsOcr, charsPerPage };
}
