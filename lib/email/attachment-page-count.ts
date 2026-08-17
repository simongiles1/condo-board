import { getPdfPageCount } from "@/lib/pdf/pdf-page-count";

import {
  attachmentKind,
} from "@/lib/email/attachment-display";

/** Types where a meaningful page count can be computed from file bytes. */
export function attachmentKindSupportsPageCount(
  kind: ReturnType<typeof attachmentKind>,
): boolean {
  return kind === "pdf";
}

/**
 * Count pages in a downloaded attachment. Returns null when the type is not
 * pageable or the bytes cannot be parsed.
 */
export async function countAttachmentPages(
  bytes: Buffer,
  mimeType: string,
): Promise<number | null> {
  const kind = attachmentKind(mimeType);
  if (!attachmentKindSupportsPageCount(kind)) {
    return null;
  }

  if (kind === "pdf") {
    try {
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return await getPdfPageCount(arrayBuffer);
    } catch (error) {
      console.warn("[attachment-page-count] PDF parse failed:", error);
      return null;
    }
  }

  return null;
}
