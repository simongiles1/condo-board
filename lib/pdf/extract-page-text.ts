/**
 * Extract selectable text from PDF pages via pdfjs (no rasterization).
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

type TextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

type Positioned = {
  str: string;
  x: number;
  y: number;
};

const Y_LINE_TOLERANCE = 3;

function joinLine(items: Positioned[]): string {
  if (items.length === 0) return "";
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let line = sorted[0]!.str;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gap = cur.x - prev.x;
    // Heuristic: large gap → space; tiny overlap/adjacent → glue.
    if (gap > 1.5) line += " ";
    line += cur.str;
  }
  return line.replace(/[ \t]+/g, " ").trim();
}

/** Group pdfjs text items into reading-order lines. */
export function textItemsToPlainText(items: TextItem[]): string {
  const positioned: Positioned[] = [];
  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    if (!str.trim()) continue;
    const transform = item.transform;
    if (!transform || transform.length < 6) continue;
    positioned.push({
      str,
      x: transform[4] ?? 0,
      y: transform[5] ?? 0,
    });
  }

  if (positioned.length === 0) return "";

  // PDF y grows upward — sort top-to-bottom, then left-to-right within line.
  positioned.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: string[] = [];
  let current: Positioned[] = [];
  let lastY: number | null = null;

  for (const item of positioned) {
    if (lastY != null && Math.abs(item.y - lastY) > Y_LINE_TOLERANCE) {
      const line = joinLine(current);
      if (line) lines.push(line);
      current = [];
    }
    current.push(item);
    lastY = item.y;
  }
  const last = joinLine(current);
  if (last) lines.push(last);

  return lines.join("\n").trim();
}

async function loadPdfDocument(bytes: Buffer) {
  const data = new Uint8Array(bytes);
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    password: "",
  });
  try {
    return await loadingTask.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/password|encrypted/i.test(message)) throw error;
    const retry = getDocument({
      data: new Uint8Array(bytes),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
      password: "",
    });
    return retry.promise;
  }
}

/** Extract plain text for one 1-based page. */
export async function extractPdfPageText(
  bytes: Buffer,
  pageNo: number,
): Promise<string> {
  if (!Number.isInteger(pageNo) || pageNo < 1) {
    throw new Error(`Invalid page number: ${pageNo}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = await loadPdfDocument(bytes);
  try {
    if (pageNo > doc.numPages) {
      throw new Error(
        `Page ${pageNo} is out of range (document has ${doc.numPages} pages).`,
      );
    }
    const page = await doc.getPage(pageNo);
    const textContent = await page.getTextContent({
      includeMarkedContent: false,
    });
    return textItemsToPlainText(textContent.items as TextItem[]);
  } finally {
    await doc.destroy?.();
  }
}

/** Extract plain text for every page (1-based map). */
export async function extractPdfAllPageTexts(
  bytes: Buffer,
): Promise<Map<number, string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = await loadPdfDocument(bytes);
  const out = new Map<number, string>();
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
      });
      out.set(
        pageNo,
        textItemsToPlainText(textContent.items as TextItem[]),
      );
    }
  } finally {
    await doc.destroy?.();
  }
  return out;
}
