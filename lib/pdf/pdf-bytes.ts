const MAX_HEADER_SCAN = 65_536;

/** Byte offset of `%PDF-`, or -1 when not found in the first 64 KiB. */
export function findPdfHeaderOffset(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length, MAX_HEADER_SCAN);
  for (let i = 0; i <= limit - 5; i += 1) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    ) {
      return i;
    }
  }
  return -1;
}

export function assertLooksLikePdf(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength === 0) {
    throw new Error(`${label} file is empty.`);
  }
  if (findPdfHeaderOffset(bytes) < 0) {
    throw new Error(
      `${label} does not look like a PDF (no %PDF- header in the first ${MAX_HEADER_SCAN} bytes). Re-export the drawing as PDF from your CAD tool — DWG, PNG, or shortcut files are not accepted.`,
    );
  }
}

/** Client-side sniff before upload (reads only the file head). */
export async function assertFileLooksLikePdf(
  file: File,
  label: string,
): Promise<void> {
  const head = new Uint8Array(await file.slice(0, MAX_HEADER_SCAN).arrayBuffer());
  assertLooksLikePdf(head, label);
}
