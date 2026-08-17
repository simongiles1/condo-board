/**
 * Pure helpers for image → page-vision enrollment (safe in client + tests).
 */

/** Profiler stamp for synthetic single-page image rows (not pdfjs). */
export const IMAGE_VISION_PROFILER_VERSION = "image-v1";

const VISION_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const VISION_IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

export function normalizeMime(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

/** Gemini-friendly image MIME types we enroll for page vision. */
export function isVisionImageMime(mimeType: string): boolean {
  const mime = normalizeMime(mimeType);
  return VISION_IMAGE_MIMES.has(mime);
}

export function isVisionImageExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  const normalized = ext.startsWith(".")
    ? ext.toLowerCase()
    : `.${ext.toLowerCase()}`;
  return VISION_IMAGE_EXTS.has(normalized);
}

/** Map image/jpg → image/jpeg for Gemini inlineData. */
export function normalizeVisionImageMime(mimeType: string): string {
  const mime = normalizeMime(mimeType);
  if (mime === "image/jpg") return "image/jpeg";
  return mime;
}

export function visionImageMimeFromExt(
  ext: string | null | undefined,
): string | null {
  if (!ext) return null;
  const normalized = ext.startsWith(".")
    ? ext.toLowerCase()
    : `.${ext.toLowerCase()}`;
  switch (normalized) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}
