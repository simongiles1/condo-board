import crypto from "crypto";

import {
  formatPdfMetadataPromptBlock,
  isNonPartySoftwareName,
  partyHintsFromPdfMetadata,
  type PdfFileMetadata,
} from "@/lib/pdf/document-properties";

export const FILE_CARD_DOCUMENT_TYPES = [
  "study",
  "tables",
  "letter",
  "proposal",
  "draft",
  "sample",
  "signed_report",
  "minutes",
  "other",
] as const;

export type FileCardDocumentType = (typeof FILE_CARD_DOCUMENT_TYPES)[number];

export type FileCardGeneratedJson = {
  document_type: FileCardDocumentType;
  summary: string;
  covering_email_context: string;
  parties: string[];
  document_date: string | null;
  email_summary?: string | null;
};

export const MAX_COVERING_EMAIL_CHARS = 2000;
export const MAX_EXTRACT_HEAD_CHARS = 8000;
export const MAX_EXTRACT_TAIL_CHARS = 2000;
export const MAX_EXTRACT_TOTAL_CHARS = 16000;
export const EMAIL_SUMMARY_THRESHOLD_CHARS = 1200;
export const FILE_CARD_PACK_VERSION = "file-card-pack-v3";
export const MAX_ASK_SUMMARY_CHARS = 320;
export const MAX_ASK_OUTLINE_CHARS = 240;
export const MAX_OUTLINE_ENTRIES = 24;
const PAGE_BREAK_PLACEHOLDER = "<!-- DOCLING_PAGE_BREAK -->";
const PAGE_SAMPLE_CHARS = 280;
const TITLE_HINT =
  /\b(table|form|appendix|schedule|notice|reserve fund|class\s+[123]|signed|contribution|cash flow)\b/i;

export type FileCardOutlineEntry = {
  page: number | null;
  title: string;
};

export const FILE_CARD_SYSTEM_PROMPT = `You analyze document attachments and their parent email context to produce a structured file card.

Return JSON only with this shape:
{
  "document_type": "study" | "tables" | "letter" | "proposal" | "draft" | "sample" | "signed_report" | "minutes" | "other",
  "summary": "one concise paragraph describing exactly what this document contains",
  "covering_email_context": "one concise sentence explaining what the covering email claims or transmits regarding this file",
  "parties": ["Vendor or Entity Name", "Engineering Firm", ...],
  "document_date": "YYYY-MM-DD or YYYY-MM or null if unknown",
  "email_summary": "1-2 sentence summary of the parent email, or null"
}

Rules:
- Verify document_type against the actual file content, not just the email claim.
- Covering emails are usually accurate context, but the file content is ground truth. For instance, if an email says "Please find attached the signed reserve fund study" but the file itself consists purely of financial projection tables or spreadsheets, document_type MUST be "tables", NOT "signed_report" or "study". If the file is clearly marked DRAFT, use "draft". If it is a sample proposal, use "proposal" or "sample".
- Keep covering_email_context separate from document_type and summary. Do not blend them.
- parties MUST include every named organization and person who authored, prepared, branded, or issued the document. Use letterhead, headers, footers, stamps, signature blocks, and DOCUMENT FILE PROPERTIES (especially Author and page-1 header text). Covering-email senders alone are not sufficient — a reserve-fund tables PDF branded Trace Consulting Group must list that firm even when the email is from the property manager.
- Include consulting / engineering firms printed in the header even when the body is only tables.
- Omit generic software names (Microsoft Excel, Adobe Acrobat, and similar producers).
- If DOCUMENT OUTLINE or middle page samples are present, the summary MUST mention interior components (notices, tables, signatures, later sections) even when they are not in the opening pages. A mixed packet is not only its cover page.
- If email_summary is requested in the prompt, summarize the email body concisely. Otherwise set email_summary to null.`;

export function hashPackedText(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

function collapseTitle(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max).trimEnd()}…`;
}

function isNoiseOutlineLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 4) return true;
  if (/^[-*|:_=\s]+$/.test(trimmed)) return true;
  if (/^\|[-:\s|]+\|$/.test(trimmed)) return true;
  const digits = (trimmed.match(/\d/g) || []).length;
  return digits > trimmed.length * 0.6 && trimmed.length > 20;
}

function titleFromPageMarkdown(pageMarkdown: string): string | null {
  const lines = pageMarkdown.split("\n").map((line) => line.trim());
  for (const line of lines) {
    if (!line || isNoiseOutlineLine(line)) continue;
    const heading = /^#{1,4}\s+(.+)$/.exec(line);
    if (heading) return collapseTitle(heading[1]);
    if (TITLE_HINT.test(line)) return collapseTitle(line);
    if (/^[A-Z0-9][A-Z0-9 ,.'&/()-]{11,}$/.test(line) && /[A-Z]{3}/.test(line)) {
      return collapseTitle(line);
    }
  }
  const first = lines.find((line) => line && !isNoiseOutlineLine(line));
  return first ? collapseTitle(first) : null;
}

/**
 * Deterministic section inventory from Docling page breaks, headings, and
 * title-like lines. Used for long mixed packets that lack a markdown TOC.
 */
export function extractDocumentOutline(
  markdown: string | null | undefined,
): FileCardOutlineEntry[] {
  const normalized = (markdown || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const entries: FileCardOutlineEntry[] = [];
  const seen = new Set<string>();
  const push = (page: number | null, title: string) => {
    const cleaned = collapseTitle(title);
    if (!cleaned) return;
    const key = `${page ?? "x"}:${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ page, title: cleaned });
  };

  if (normalized.includes(PAGE_BREAK_PLACEHOLDER)) {
    const pages = normalized.split(PAGE_BREAK_PLACEHOLDER);
    pages.forEach((pageMarkdown, index) => {
      if (entries.length >= MAX_OUTLINE_ENTRIES) return;
      const title = titleFromPageMarkdown(pageMarkdown);
      if (title) push(index + 1, title);
    });
    return entries;
  }

  for (const line of normalized.split("\n")) {
    if (entries.length >= MAX_OUTLINE_ENTRIES) break;
    const trimmed = line.trim();
    if (!trimmed || isNoiseOutlineLine(trimmed)) continue;
    const heading = /^#{1,4}\s+(.+)$/.exec(trimmed);
    if (heading) {
      push(null, heading[1]);
      continue;
    }
    if (TITLE_HINT.test(trimmed)) push(null, trimmed);
  }
  return entries;
}

function formatOutlineBlock(entries: FileCardOutlineEntry[]): string {
  return entries
    .map((entry) =>
      entry.page != null ? `p.${entry.page} ${entry.title}` : entry.title,
    )
    .join("\n");
}

function middlePageSamples(markdown: string, headEnd: number, tailStart: number): string {
  if (!markdown.includes(PAGE_BREAK_PLACEHOLDER)) {
    const middle = markdown.slice(headEnd, tailStart);
    if (middle.length < 800) return "";
    const step = Math.max(2000, Math.floor(middle.length / 6));
    const samples: string[] = [];
    for (let offset = 0; offset < middle.length && samples.length < 6; offset += step) {
      const slice = collapseTitle(middle.slice(offset, offset + PAGE_SAMPLE_CHARS), PAGE_SAMPLE_CHARS);
      if (slice.length > 40) samples.push(slice);
    }
    return samples.join("\n\n");
  }

  let cursor = 0;
  const samples: string[] = [];
  const pages = markdown.split(PAGE_BREAK_PLACEHOLDER);
  pages.forEach((pageMarkdown, index) => {
    const start = cursor;
    cursor += pageMarkdown.length + PAGE_BREAK_PLACEHOLDER.length;
    if (start < headEnd || start >= tailStart) return;
    const sample = collapseTitle(pageMarkdown, PAGE_SAMPLE_CHARS);
    if (sample.length > 40) {
      samples.push(`p.${index + 1}: ${sample}`);
    }
  });
  return samples.slice(0, 8).join("\n\n");
}

/**
 * Extract representative markdown content within the 16k character budget.
 * Includes beginning, ending, an extractive outline, and page samples when
 * markdown headings in the middle are sparse.
 */
export function extractRepresentativeMarkdown(
  markdown: string | null | undefined,
  totalCap = MAX_EXTRACT_TOTAL_CHARS,
): string {
  const normalized = (markdown || "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= totalCap) {
    return normalized;
  }

  const outline = extractDocumentOutline(normalized);
  const head = normalized.slice(0, MAX_EXTRACT_HEAD_CHARS).trimEnd();
  const tail = normalized.slice(-MAX_EXTRACT_TAIL_CHARS).trimStart();
  const middleText = normalized.slice(
    MAX_EXTRACT_HEAD_CHARS,
    Math.max(MAX_EXTRACT_HEAD_CHARS, normalized.length - MAX_EXTRACT_TAIL_CHARS),
  );

  const middleHeadings = middleText
    .split("\n")
    .filter((line) => /^#{1,4}\s+\S+/.test(line.trim()))
    .map((line) => line.trim());

  const availableMiddleBudget = Math.max(
    800,
    totalCap - head.length - tail.length - 200,
  );

  const parts = [head];
  if (outline.length > 0) {
    const outlineBlock = formatOutlineBlock(outline);
    const clipped =
      outlineBlock.length > 1200
        ? `${outlineBlock.slice(0, 1200).trimEnd()}…`
        : outlineBlock;
    parts.push(`\n--- [DOCUMENT OUTLINE] ---\n${clipped}`);
  }

  let used = parts.join("\n").length + tail.length;
  const remaining = Math.max(400, availableMiddleBudget - (used - head.length));

  if (middleHeadings.length >= 3) {
    const joined = middleHeadings.join("\n");
    const truncated =
      joined.length > remaining ? `${joined.slice(0, remaining)}…` : joined;
    parts.push(`\n--- [MIDDLE SECTION HEADINGS] ---\n${truncated}`);
  } else {
    const samples = middlePageSamples(
      normalized,
      MAX_EXTRACT_HEAD_CHARS,
      normalized.length - MAX_EXTRACT_TAIL_CHARS,
    );
    if (samples) {
      const truncated =
        samples.length > remaining ? `${samples.slice(0, remaining)}…` : samples;
      parts.push(`\n--- [MIDDLE PAGE SAMPLES] ---\n${truncated}`);
    }
  }

  parts.push(`\n--- [DOCUMENT CONCLUSION / SIGNATURE AREA] ---\n${tail}`);
  return parts.join("\n");
}

export type FileCardAskFields = {
  documentType: string;
  summary: string;
  coveringEmailContext?: string | null;
  parties?: string[];
  documentDate?: string | null;
  sections?: FileCardOutlineEntry[];
};

function clipAskText(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max).trimEnd()}…`;
}

/** Compact file-card fields for rerank excerpts and answer packing. */
export function formatFileCardAskParts(card: FileCardAskFields): string[] {
  const parts = [
    `Document Type: ${card.documentType}`,
    `Summary: ${clipAskText(card.summary, MAX_ASK_SUMMARY_CHARS)}`,
  ];
  if (card.parties && card.parties.length > 0) {
    parts.push(`Parties: ${card.parties.slice(0, 8).join("; ")}`);
  }
  if (card.documentDate?.trim()) {
    parts.push(`Date: ${card.documentDate.trim()}`);
  }
  if (card.coveringEmailContext?.trim()) {
    parts.push(
      `Covering Email Context: ${clipAskText(card.coveringEmailContext, 220)}`,
    );
  }
  if (card.sections && card.sections.length > 0) {
    const outline = card.sections
      .slice(0, 8)
      .map((entry) =>
        entry.page != null ? `p.${entry.page} ${entry.title}` : entry.title,
      )
      .join("; ");
    parts.push(`Outline: ${clipAskText(outline, MAX_ASK_OUTLINE_CHARS)}`);
  }
  return parts;
}

export function formatFileCardRerankExcerpt(card: FileCardAskFields): string {
  const parties =
    card.parties && card.parties.length > 0
      ? ` parties: ${card.parties.slice(0, 6).join("; ")}`
      : "";
  const date = card.documentDate?.trim() ? ` date: ${card.documentDate.trim()}` : "";
  return `[${card.documentType}] ${clipAskText(card.summary, MAX_ASK_SUMMARY_CHARS)}${parties}${date}`;
}

export type PackFileCardParams = {
  filename: string;
  subject?: string | null;
  coveringEmailText?: string | null;
  markdown: string;
  includeEmailSummaryPrompt?: boolean;
  fileMetadata?: PdfFileMetadata | null;
};

export type PackedFileCardResult = {
  userPrompt: string;
  inputHash: string;
  inputChars: number;
  packedExcerpt: string;
};

export function packFileCardPrompt(params: PackFileCardParams): PackedFileCardResult {
  const filename = params.filename.trim() || "attachment";
  const subject = params.subject?.trim() || "(no subject)";
  const rawEmail = params.coveringEmailText?.trim() || "";
  const emailExcerpt =
    rawEmail.length > MAX_COVERING_EMAIL_CHARS
      ? `${rawEmail.slice(0, MAX_COVERING_EMAIL_CHARS).trimEnd()}…`
      : rawEmail;

  const contentText = extractRepresentativeMarkdown(params.markdown);
  const outline = extractDocumentOutline(params.markdown);
  const outlineBlock =
    outline.length > 0
      ? `DOCUMENT OUTLINE:\n${formatOutlineBlock(outline)}`
      : "";

  const sections = [
    `PACK VERSION: ${FILE_CARD_PACK_VERSION}`,
    `ATTACHMENT FILENAME: ${filename}`,
    `COVERING EMAIL SUBJECT: ${subject}`,
    formatPdfMetadataPromptBlock(params.fileMetadata),
    `COVERING EMAIL BODY:\n${emailExcerpt || "(empty)"}`,
    outlineBlock,
    `EXTRACTED ATTACHMENT CONTENT:\n${contentText || "(empty)"}`,
  ].filter(Boolean);

  if (params.includeEmailSummaryPrompt) {
    sections.push(
      "NOTE: The parent email is substantial. Please provide a concise 1-2 sentence email_summary in the JSON output.",
    );
  } else {
    sections.push("NOTE: Set email_summary to null.");
  }

  const userPrompt = sections.join("\n\n");
  const inputHash = hashPackedText(userPrompt);
  const inputChars = userPrompt.length;
  const packedExcerpt = userPrompt.slice(0, 400).replace(/\s+/g, " ").trim();

  return {
    userPrompt,
    inputHash,
    inputChars,
    packedExcerpt,
  };
}

export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*)\r?\n```\s*$/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function normalizeDocType(val: unknown): FileCardDocumentType {
  if (typeof val !== "string") return "other";
  const lowered = val.toLowerCase().trim().replace(/[-\s]+/g, "_");
  if ((FILE_CARD_DOCUMENT_TYPES as readonly string[]).includes(lowered)) {
    return lowered as FileCardDocumentType;
  }
  if (lowered.includes("study") || lowered.includes("rfs")) return "study";
  if (lowered.includes("table") || lowered.includes("schedule")) return "tables";
  if (lowered.includes("letter") || lowered.includes("memo")) return "letter";
  if (lowered.includes("proposal") || lowered.includes("quote")) return "proposal";
  if (lowered.includes("draft")) return "draft";
  if (lowered.includes("sample")) return "sample";
  if (lowered.includes("sign")) return "signed_report";
  if (lowered.includes("minute")) return "minutes";
  return "other";
}

export function parseFileCardJson(rawText: string): FileCardGeneratedJson | null {
  const stripped = stripJsonFence(rawText);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const docType = normalizeDocType(parsed.document_type ?? parsed.documentType);
  const summary =
    typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const coveringEmailContext =
    typeof parsed.covering_email_context === "string"
      ? parsed.covering_email_context.trim()
      : typeof parsed.coveringEmailContext === "string"
        ? (parsed.coveringEmailContext as string).trim()
        : "";

  if (!summary) return null;

  const rawParties = parsed.parties;
  const parties: string[] = Array.isArray(rawParties)
    ? rawParties
        .filter((p): p is string => typeof p === "string" && Boolean(p.trim()))
        .map((p) => p.trim())
    : [];

  const rawDate =
    typeof parsed.document_date === "string"
      ? parsed.document_date.trim()
      : typeof parsed.documentDate === "string"
        ? (parsed.documentDate as string).trim()
        : null;

  const emailSummary =
    typeof parsed.email_summary === "string" && parsed.email_summary.trim()
      ? parsed.email_summary.trim()
      : typeof parsed.emailSummary === "string" &&
          (parsed.emailSummary as string).trim()
        ? (parsed.emailSummary as string).trim()
        : null;

  return {
    document_type: docType,
    summary,
    covering_email_context: coveringEmailContext,
    parties,
    document_date: rawDate || null,
    email_summary: emailSummary,
  };
}

export function mergeFileCardParties(
  parties: string[],
  fileMetadata?: PdfFileMetadata | null,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (isNonPartySoftwareName(trimmed)) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(trimmed);
  };
  for (const party of parties) push(party);
  for (const hint of partyHintsFromPdfMetadata(fileMetadata)) push(hint);
  return merged;
}

/**
 * Skip only when the packed prompt is byte-identical. Near-miss char ratios
 * would hide prompt/metadata upgrades (letterhead, PDF Author, pack version).
 */
export function canSkipCardGeneration(params: {
  existingInputHash?: string | null;
  existingInputChars?: number | null;
  newInputHash: string;
  newInputChars: number;
  forceOverwrite?: boolean;
  thresholdRatio?: number;
}): boolean {
  if (params.forceOverwrite) return false;
  if (!params.existingInputHash) return false;
  return params.existingInputHash === params.newInputHash;
}
