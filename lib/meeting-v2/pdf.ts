import path from "node:path";
import { pathToFileURL } from "node:url";

import { maybeCleanupPdfPagesWithDeepSeek } from "@/lib/meeting-v2/pdf-deepseek";

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
};

type PdfPageText = {
  pageNumber: number;
  heading: string | null;
  text: string;
};

function roundLineY(value: number): number {
  return Math.round(value / 2) * 2;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferHeading(lines: string[]): string | null {
  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;
    if (line.length > 140) continue;
    if (/^\d+$/.test(line)) continue;
    return line;
  }
  return null;
}

function buildPageText(items: PdfTextItem[]): { text: string; heading: string | null } {
  const normalized = items
    .filter((item) => normalizeWhitespace(item.str ?? "").length > 0)
    .map((item) => ({
      text: normalizeWhitespace(item.str ?? ""),
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lineMap = new Map<number, { y: number; parts: { x: number; text: string }[] }>();

  for (const item of normalized) {
    const key = roundLineY(item.y);
    const existing = lineMap.get(key);
    if (existing) {
      existing.parts.push({ x: item.x, text: item.text });
    } else {
      lineMap.set(key, { y: item.y, parts: [{ x: item.x, text: item.text }] });
    }
  }

  const lines = [...lineMap.values()]
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      normalizeWhitespace(
        line.parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.text)
          .join(" "),
      )
    )
    .filter(Boolean);

  return {
    text: lines.join("\n"),
    heading: inferHeading(lines),
  };
}

async function loadPdfJs() {
  const pdfJsPath = path.resolve(
    process.cwd(),
    "node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js",
  );
  const moduleUrl = pathToFileURL(pdfJsPath).href;

  return (await import(/* webpackIgnore: true */ moduleUrl)) as {
    getDocument: (options: {
      data: Uint8Array;
      disableFontFace: boolean;
    }) => { promise: Promise<{ numPages: number; getPage: (pageNumber: number) => Promise<{
      getTextContent: (options: { disableCombineTextItems: boolean }) => Promise<{
        items: PdfTextItem[];
      }>;
    }> }> };
  };
}

export async function extractPdfPagesWithText(buffer: Buffer): Promise<{
  pageCount: number;
  pages: PdfPageText[];
}>;
export async function extractPdfPagesWithText(
  buffer: Buffer,
  options: {
    startPage?: number;
    onPage?: (page: PdfPageText, totalPages: number) => Promise<void> | void;
  },
): Promise<{
  pageCount: number;
  pages: PdfPageText[];
}>;
export async function extractPdfPagesWithText(
  buffer: Buffer,
  options?: {
    startPage?: number;
    onPage?: (page: PdfPageText, totalPages: number) => Promise<void> | void;
  },
): Promise<{
  pageCount: number;
  pages: PdfPageText[];
}> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  const pages: PdfPageText[] = [];
  const startPage = Math.max(1, options?.startPage ?? 1);

  for (let pageNumber = startPage; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent({ disableCombineTextItems: false });
    const { text, heading } = buildPageText(content.items as PdfTextItem[]);
    const rawPage = {
      pageNumber,
      heading,
      text,
    };
    const [cleanedPage] = await maybeCleanupPdfPagesWithDeepSeek([rawPage]);
    const finalPage = cleanedPage ?? rawPage;
    pages.push(finalPage);
    await options?.onPage?.(finalPage, doc.numPages);
  }

  return {
    pageCount: doc.numPages,
    pages,
  };
}

export function buildBasicDocumentSections(
  pages: Array<{ pageNumber: number; heading: string | null }>,
): Array<{
  title: string;
  startPage: number;
  endPage: number;
  sortOrder: number;
}> {
  return pages.map((page, index) => ({
    title: page.heading ?? `Page ${page.pageNumber}`,
    startPage: page.pageNumber,
    endPage: page.pageNumber,
    sortOrder: index,
  }));
}
