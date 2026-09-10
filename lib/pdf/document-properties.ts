/**
 * PDF Info dictionary + first-page header/footer text (pdfjs).
 * Letterhead logos are often images; selectable header text and Author still
 * identify the preparing firm/person when markdown conversion drops them.
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

type PdfDocumentInit = Parameters<typeof getDocument>[0];

type TextItem = {
  str?: string;
  transform?: number[];
};

export type PdfFileMetadata = {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  pageCount: number | null;
  headerText: string | null;
  footerText: string | null;
  extractedAt: string;
};

const HEADER_BAND_FRAC = 0.2;
const FOOTER_BAND_FRAC = 0.12;
const MAX_BAND_CHARS = 1200;

const SOFTWARE_IDENTITY =
  /microsoft|adobe|acrobat|excel|word|powerpoint|libreoffice|openoffice|google docs|chrome|edge|safari|quartz|preview|writer|pdf-lib|ghostscript|itext|nitro|foxit|skia|cairo/i;

const ORG_HINT =
  /\b(ltd\.?|limited|inc\.?|incorporated|llc|llp|corp\.?|corporation|group|consulting|consultants|engineering|engineers|associates|architects?|partners)\b/i;

function cleanScalar(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const joined = value
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join("; ");
    return joined || null;
  }
  if (typeof value === "string") {
    const trimmed = value.replace(/\u0000/g, "").trim();
    return trimmed && trimmed !== "-" ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const pdf = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(
      trimmed,
    );
    if (pdf) {
      const year = Number(pdf[1]);
      const month = Number(pdf[2] || "01") - 1;
      const day = Number(pdf[3] || "01");
      const hour = Number(pdf[4] || "00");
      const minute = Number(pdf[5] || "00");
      const second = Number(pdf[6] || "00");
      const date = new Date(Date.UTC(year, month, day, hour, minute, second));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    return trimmed || null;
  }
  return null;
}

function isSoftwareIdentity(value: string | null): boolean {
  if (!value) return false;
  return SOFTWARE_IDENTITY.test(value);
}

function joinBand(lines: string[]): string | null {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  if (unique.length === 0) return null;
  const joined = unique.join("\n");
  return joined.length > MAX_BAND_CHARS
    ? `${joined.slice(0, MAX_BAND_CHARS).trimEnd()}…`
    : joined;
}

async function loadPdfDocument(bytes: Buffer) {
  const data = new Uint8Array(bytes);
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    password: "",
  } as PdfDocumentInit);
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
    } as PdfDocumentInit);
    return retry.promise;
  }
}

function bandLinesFromItems(
  items: TextItem[],
  pageHeight: number,
  kind: "header" | "footer",
): string[] {
  const positioned: Array<{ str: string; x: number; y: number }> = [];
  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    if (!str.trim()) continue;
    const transform = item.transform;
    if (!transform || transform.length < 6) continue;
    const y = transform[5] ?? 0;
    const inHeader = y >= pageHeight * (1 - HEADER_BAND_FRAC);
    const inFooter = y <= pageHeight * FOOTER_BAND_FRAC;
    if (kind === "header" && !inHeader) continue;
    if (kind === "footer" && !inFooter) continue;
    positioned.push({ str, x: transform[4] ?? 0, y });
  }
  positioned.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: string[] = [];
  let current: typeof positioned = [];
  let lastY: number | null = null;
  const yTol = 3;
  const flush = () => {
    if (current.length === 0) return;
    const sorted = [...current].sort((a, b) => a.x - b.x);
    const line = sorted
      .map((part) => part.str)
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (line) lines.push(line);
    current = [];
  };
  for (const item of positioned) {
    if (lastY != null && Math.abs(item.y - lastY) > yTol) flush();
    current.push(item);
    lastY = item.y;
  }
  flush();
  return lines;
}

export function isPdfAttachment(mimeType: string, ext: string): boolean {
  const mime = mimeType.toLowerCase();
  const extension = ext.toLowerCase();
  return mime.includes("pdf") || extension === ".pdf";
}

export function looksLikeOrganizationName(value: string): boolean {
  return ORG_HINT.test(value);
}

export function isNonPartySoftwareName(value: string | null): boolean {
  return isSoftwareIdentity(value);
}

/** Names from Author + letterhead lines that look like firms. */
export function partyHintsFromPdfMetadata(
  meta: PdfFileMetadata | null | undefined,
): string[] {
  if (!meta) return [];
  const hints: string[] = [];
  const author = meta.author?.trim();
  if (author && !isSoftwareIdentity(author)) hints.push(author);

  const headerLines = (meta.headerText || "").split("\n");
  const footerLines = (meta.footerText || "").split("\n");
  for (const line of [...headerLines, ...footerLines]) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 120) continue;
    if (isSoftwareIdentity(trimmed)) continue;
    if (looksLikeOrganizationName(trimmed)) hints.push(trimmed);
  }
  return hints;
}

export function formatPdfMetadataPromptBlock(
  meta: PdfFileMetadata | null | undefined,
): string {
  if (!meta) {
    return "DOCUMENT FILE PROPERTIES:\n(none extracted)";
  }
  const rows: Array<[string, string | null]> = [
    ["Title", meta.title],
    ["Author", meta.author],
    ["Subject", meta.subject],
    ["Keywords", meta.keywords],
    ["Creator / Application", meta.creator],
    ["PDF producer", meta.producer],
    ["Created", meta.creationDate],
    ["Modified", meta.modificationDate],
    ["Page count", meta.pageCount != null ? String(meta.pageCount) : null],
  ];
  const lines = rows
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}: ${value}`);
  const header = meta.headerText?.trim()
    ? `Page 1 header text:\n${meta.headerText.trim()}`
    : "Page 1 header text: (none)";
  const footer = meta.footerText?.trim()
    ? `Page 1 footer text:\n${meta.footerText.trim()}`
    : "Page 1 footer text: (none)";
  if (lines.length === 0) {
    return `DOCUMENT FILE PROPERTIES:\n(none in Info dictionary)\n${header}\n${footer}`;
  }
  return `DOCUMENT FILE PROPERTIES:\n${lines.join("\n")}\n${header}\n${footer}`;
}

export async function extractPdfFileMetadata(
  bytes: Buffer,
): Promise<PdfFileMetadata> {
  const extractedAt = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = await loadPdfDocument(bytes);
  try {
    let info: Record<string, unknown> = {};
    try {
      const meta = await doc.getMetadata();
      if (meta?.info && typeof meta.info === "object") {
        info = meta.info as Record<string, unknown>;
      }
    } catch {
      info = {};
    }

    let headerText: string | null = null;
    let footerText: string | null = null;
    if (doc.numPages >= 1) {
      const page = await doc.getPage(1);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent({
          includeMarkedContent: false,
        });
        const items = textContent.items as TextItem[];
        headerText = joinBand(
          bandLinesFromItems(items, viewport.height, "header"),
        );
        footerText = joinBand(
          bandLinesFromItems(items, viewport.height, "footer"),
        );
      } finally {
        page.cleanup?.();
      }
    }

    return {
      title: cleanScalar(info.Title),
      author: cleanScalar(info.Author),
      subject: cleanScalar(info.Subject),
      keywords: cleanScalar(info.Keywords),
      creator: cleanScalar(info.Creator),
      producer: cleanScalar(info.Producer),
      creationDate: toIsoDate(info.CreationDate),
      modificationDate: toIsoDate(info.ModDate),
      pageCount: typeof doc.numPages === "number" ? doc.numPages : null,
      headerText,
      footerText,
      extractedAt,
    };
  } finally {
    try {
      await doc.destroy?.();
    } catch {
      // pdfjs versions differ on destroy
    }
  }
}
