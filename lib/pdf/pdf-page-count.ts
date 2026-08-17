import { loadPdfLibDocument } from "@/lib/pdf/extract-pages";

/** Page count without loading pdf.js (safe for client bundle, no DOM APIs). */
export async function getPdfPageCount(source: ArrayBuffer): Promise<number> {
  const doc = await loadPdfLibDocument(source);
  return doc.getPageCount();
}
