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
export const FILE_CARD_PACK_VERSION = "file-card-pack-v2";

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
- If email_summary is requested in the prompt, summarize the email body concisely. Otherwise set email_summary to null.`;

export function hashPackedText(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

/**
 * Extract representative markdown content within the 16k character budget.
 * Includes beginning, ending, and intermediate headings / TOC lines.
 */
export function extractRepresentativeMarkdown(
  markdown: string | null | undefined,
  totalCap = MAX_EXTRACT_TOTAL_CHARS,
): string {
  const normalized = (markdown || "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= totalCap) {
    return normalized;
  }

  const head = normalized.slice(0, MAX_EXTRACT_HEAD_CHARS).trimEnd();
  const tail = normalized.slice(-MAX_EXTRACT_TAIL_CHARS).trimStart();
  const middleText = normalized.slice(
    MAX_EXTRACT_HEAD_CHARS,
    normalized.length - MAX_EXTRACT_TAIL_CHARS,
  );

  // Harvest markdown headings from middle text (TOC / structural signals)
  const middleHeadings = middleText
    .split("\n")
    .filter((line) => /^#{1,4}\s+\S+/.test(line.trim()))
    .map((line) => line.trim())
    .join("\n");

  const availableMiddleBudget = Math.max(
    500,
    totalCap - head.length - tail.length - 100,
  );
  const truncatedMiddle =
    middleHeadings.length > availableMiddleBudget
      ? `${middleHeadings.slice(0, availableMiddleBudget)}…`
      : middleHeadings;

  const parts = [head];
  if (truncatedMiddle) {
    parts.push(`\n--- [MIDDLE SECTION HEADINGS] ---\n${truncatedMiddle}`);
  }
  parts.push(`\n--- [DOCUMENT CONCLUSION / SIGNATURE AREA] ---\n${tail}`);
  return parts.join("\n");
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

  const sections = [
    `PACK VERSION: ${FILE_CARD_PACK_VERSION}`,
    `ATTACHMENT FILENAME: ${filename}`,
    `COVERING EMAIL SUBJECT: ${subject}`,
    formatPdfMetadataPromptBlock(params.fileMetadata),
    `COVERING EMAIL BODY:\n${emailExcerpt || "(empty)"}`,
    `EXTRACTED ATTACHMENT CONTENT:\n${contentText || "(empty)"}`,
  ];

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
