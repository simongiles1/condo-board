import { PDFDocument } from "pdf-lib";

/** Page count without loading pdf.js (safe for client bundle, no DOM APIs). */
export async function getPdfPageCount(source: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(source);
  return doc.getPageCount();
}
