import { PDFDocument } from "pdf-lib";

/** Copy 1-based page numbers from `source` into a new PDF byte array. */
export async function extractPdfPages(
  source: ArrayBuffer,
  pageNumbers: number[],
): Promise<Uint8Array> {
  const uniqueSorted = [
    ...new Set(
      pageNumbers.filter((n) => Number.isInteger(n) && n >= 1),
    ),
  ].sort((a, b) => a - b);

  if (uniqueSorted.length === 0) {
    throw new Error("Select at least one page to include.");
  }

  const src = await PDFDocument.load(source);
  const total = src.getPageCount();

  for (const n of uniqueSorted) {
    if (n > total) {
      throw new Error(`Page ${n} is out of range (document has ${total} pages).`);
    }
  }

  const dst = await PDFDocument.create();
  const copied = await dst.copyPages(
    src,
    uniqueSorted.map((n) => n - 1),
  );
  for (const page of copied) {
    dst.addPage(page);
  }

  return dst.save();
}

export function defaultInitialPageSelection(
  pageCount: number,
  defaultThrough = 20,
): number[] {
  if (pageCount <= 0) return [];
  const end = Math.min(pageCount, defaultThrough);
  return Array.from({ length: end }, (_, i) => i + 1);
}
