import path from "node:path";
import { pathToFileURL } from "node:url";

import { convertPagesWithIbmDocling, listIbmDoclingCredentials } from "@/lib/email/docling-ibm";
import { maybeCleanupPdfPagesWithDeepSeek } from "@/lib/meeting-v2/pdf-deepseek";

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
};

export type PdfPageText = {
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

export function inferHeading(lines: string[]): string | null {
  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;
    if (line.length > 140) continue;
    if (/^\d+$/.test(line)) continue;
    return line;
  }
  return null;
}

export function inferHeadingFromMarkdown(markdown: string): string | null {
  const lines = markdown.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headerMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headerMatch) {
      const heading = normalizeWhitespace(headerMatch[1] ?? "");
      if (heading && heading.length <= 140 && !/^\d+$/.test(heading)) {
        return heading;
      }
    }
  }
  return inferHeading(lines);
}

export function isLikelyDoclingMarkdown(text: string): boolean {
  const sample = text.trim();
  if (!sample) return false;
  if (/^#{1,6}\s+\S/m.test(sample)) return true;
  if (/^\|[^\n]+\|/m.test(sample) && /\|[\s:|-]+\|/.test(sample)) return true;
  if (sample.includes("<!-- image -->")) return true;
  return false;
}

export function isEmailAttachmentPage(text: string): boolean {
  const slice = text.slice(0, 1200);
  const hasFrom = /\b(From|De)\s*:[^\n]+@[^\n]+/i.test(slice);
  const hasSent = /\b(Sent|Date|Envoyé)\s*:[^\n]+/i.test(slice);
  const hasSubject = /\b(Subject|Objet)\s*:[^\n]+/i.test(slice);
  return hasFrom && hasSent && hasSubject;
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

export type ExtractPdfPagesOptions = {
  startPage?: number;
  pdfPath?: string;
  maxDoclingPages?: number;
  onPage?: (page: PdfPageText, totalPages: number) => Promise<void> | void;
};

export async function extractPdfPagesWithText(
  buffer: Buffer,
  options?: ExtractPdfPagesOptions,
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
  const maxDoclingPages = Math.min(doc.numPages, options?.maxDoclingPages ?? 20);

  // Fast pre-pass with pdfjs for core pages (up to maxDoclingPages) to inspect structure & detect email cutoff
  const rawCorePages: PdfPageText[] = [];
  for (let p = 1; p <= maxDoclingPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ disableCombineTextItems: false });
    const { text, heading } = buildPageText(content.items as PdfTextItem[]);
    rawCorePages.push({ pageNumber: p, heading, text });
  }

  // Detect where the core agenda/report ends and email attachments begin
  let doclingCutoff = maxDoclingPages;
  for (const page of rawCorePages) {
    if (page.pageNumber >= 4 && isEmailAttachmentPage(page.text)) {
      doclingCutoff = page.pageNumber - 1;
      break;
    }
  }
  doclingCutoff = Math.max(Math.min(doc.numPages, 2), doclingCutoff);

  // Select core pages for Docling extraction
  const doclingPageNumbers: number[] = [];
  if (options?.pdfPath && listIbmDoclingCredentials().length > 0) {
    for (let p = startPage; p <= doclingCutoff; p += 1) {
      doclingPageNumbers.push(p);
    }
  }

  const doclingMap = new Map<number, string>();
  if (doclingPageNumbers.length > 0 && options?.pdfPath) {
    try {
      const result = await convertPagesWithIbmDocling({
        pdfPath: options.pdfPath,
        pages: doclingPageNumbers,
        filename: path.basename(options.pdfPath),
      });
      for (const p of result.pages) {
        doclingMap.set(p.pageNo, p.markdown);
      }
    } catch (error) {
      console.warn(
        "[meeting-v2/pdf] IBM Docling extraction failed, falling back to pdfjs text:",
        error,
      );
    }
  }

  // Sequential emission of all pages
  for (let pageNumber = startPage; pageNumber <= doc.numPages; pageNumber += 1) {
    let finalPage: PdfPageText;
    const doclingMd = doclingMap.get(pageNumber);
    if (doclingMd) {
      finalPage = {
        pageNumber,
        heading: inferHeadingFromMarkdown(doclingMd),
        text: doclingMd,
      };
    } else {
      const cached = rawCorePages.find((p) => p.pageNumber === pageNumber);
      const rawPage =
        cached ??
        (await (async () => {
          const page = await doc.getPage(pageNumber);
          const content = await page.getTextContent({ disableCombineTextItems: false });
          const { text, heading } = buildPageText(content.items as PdfTextItem[]);
          return { pageNumber, heading, text };
        })());
      const [cleanedPage] = await maybeCleanupPdfPagesWithDeepSeek([rawPage]);
      finalPage = cleanedPage ?? rawPage;
    }
    pages.push(finalPage);
    await options?.onPage?.(finalPage, doc.numPages);
  }

  return {
    pageCount: doc.numPages,
    pages,
  };
}

const SUBORDINATE_HEADER_RE =
  /^(?:Tender Summary|Pricing and Timeline|Pricing|Timeline|Recommendation|Management Recommendation|Applied subsequently|Note|Background|Scope of Work|Deliverables|Option \d|Cost Breakdown|Summary of Bids|Bid Comparison|Analysis)/i;

const MAJOR_SECTION_RE =
  /^(?:Call to Order|Ratification of Agenda|Agenda|Table of Contents|Meeting with|Review and Approval|Financial Statements|Financial Matters|Property Management Report|Adjournment|Next Meeting)/i;

function extractMajorSectionHeading(
  text: string | null | undefined,
  fallbackHeading: string | null,
  pageNumber: number,
): string | null {
  const raw = text || "";
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  if (isEmailAttachmentPage(raw)) {
    const subMatch = raw.match(/Subject\s*:\s*([^\r\n]+)/i);
    return subMatch
      ? `Email: ${subMatch[1].trim().slice(0, 80)}`
      : `Email Attachment (Page ${pageNumber})`;
  }

  // Detect the master meeting agenda outline page
  if (
    /\bAGENDA\b/i.test(raw) ||
    (/\bCall to Order\b/i.test(raw) && /\bAdjournment\b/i.test(raw))
  ) {
    return "Meeting Agenda";
  }

  for (const line of lines.slice(0, 8)) {
    const cleanLine = line.replace(/^#{1,4}\s+/, "").trim();
    if (!cleanLine || cleanLine.startsWith("<!--") || cleanLine.length < 3) continue;

    if (SUBORDINATE_HEADER_RE.test(cleanLine)) continue;

    // Check for major lettered section inside reports: "A. Ratification...", "B. Review and approval...", "C. Items completed", "D. Items for Discussion"
    const letMatch = cleanLine.match(/^([A-E]\.\s+[A-Za-z].+)$/);
    if (letMatch && cleanLine.length < 120) {
      return `Property Management Report: ${letMatch[1]}`;
    }

    // Check for named major sections
    if (MAJOR_SECTION_RE.test(cleanLine) && cleanLine.length < 120) {
      if (cleanLine.toLowerCase().startsWith("call to order") && (raw.includes("Adjournment") || raw.includes("AGENDA"))) {
        return "Meeting Agenda";
      }
      return cleanLine;
    }
  }

  if (fallbackHeading && fallbackHeading.length > 3 && fallbackHeading.length < 100) {
    if (!SUBORDINATE_HEADER_RE.test(fallbackHeading)) {
      return fallbackHeading;
    }
  }

  return null;
}

export function buildSemanticDocumentSections(
  pages: Array<{ pageNumber: number; heading: string | null; text?: string }>,
): Array<{
  title: string;
  startPage: number;
  endPage: number;
  sortOrder: number;
}> {
  if (pages.length === 0) return [];
  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const sections: Array<{
    title: string;
    startPage: number;
    endPage: number;
    sortOrder: number;
  }> = [];
  let currentSection: {
    title: string;
    startPage: number;
    endPage: number;
    sortOrder: number;
  } | null = null;

  for (const p of ordered) {
    const detectedHeading = extractMajorSectionHeading(p.text, p.heading, p.pageNumber);

    if (p.pageNumber === 1) {
      currentSection = {
        title: detectedHeading || "Management Report Cover",
        startPage: 1,
        endPage: 1,
        sortOrder: 0,
      };
      sections.push(currentSection);
      continue;
    }

    if (p.pageNumber === 2 && !detectedHeading?.toLowerCase().includes("management")) {
      currentSection = {
        title: detectedHeading || "Meeting Agenda & Outline",
        startPage: 2,
        endPage: 2,
        sortOrder: sections.length,
      };
      sections.push(currentSection);
      continue;
    }

    const isNewSection = Boolean(detectedHeading);
    const exceedsMaxPages = currentSection && p.pageNumber - currentSection.startPage >= 6;

    if (isNewSection || exceedsMaxPages || !currentSection) {
      const sectionTitle: string =
        detectedHeading ||
        (currentSection ? `${currentSection.title} (Cont.)` : `Section Page ${p.pageNumber}`);
      currentSection = {
        title: sectionTitle,
        startPage: p.pageNumber,
        endPage: p.pageNumber,
        sortOrder: sections.length,
      };
      sections.push(currentSection);
    } else {
      currentSection.endPage = p.pageNumber;
    }
  }

  return sections;
}

export function buildBasicDocumentSections(
  pages: Array<{ pageNumber: number; heading: string | null; text?: string }>,
): Array<{
  title: string;
  startPage: number;
  endPage: number;
  sortOrder: number;
}> {
  return buildSemanticDocumentSections(pages);
}
