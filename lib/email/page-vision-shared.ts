/**
 * Pure helpers for Tier 2 page vision (safe to import in unit tests).
 */

import path from "path";

export const PAGE_VISION_PARSER_NAME = "cf-tomarkdown+gemini-vision";

export const PAGE_VISION_BATCH_SIZE = 4;
export const PAGE_VISION_MAX_ATTEMPTS = 3;
/** Default 15 minutes — reclaim crashed `processing` rows. */
export const PAGE_VISION_STALE_PROCESSING_MS = 900_000;
/** Pause after a rate-limit 429 before claiming more pages in the same doc. */
export const PAGE_VISION_RATE_LIMIT_BACKOFF_MS = 15_000;
/** Give up on this document after this many rate-limit rounds (pages stay pending). */
export const PAGE_VISION_RATE_LIMIT_MAX_ROUNDS = 4;

export type PageVisionStatus =
  | "not_needed"
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

/** Relative key under process.cwd() for a per-page vision artifact. */
export function pageVisionArtifactRelativeKey(
  contentHash: string,
  pageNo: number,
): string {
  const padded = String(pageNo).padStart(3, "0");
  return path.posix.join(
    "data",
    "email-attachments",
    contentHash,
    "vision",
    `p${padded}.md`,
  );
}

export function pageVisionMarkerOpen(pageNo: number): string {
  return `<!-- vision:page=${pageNo} -->`;
}

export function pageVisionMarkerClose(pageNo: number): string {
  return `<!-- /vision:page=${pageNo} -->`;
}

export function formatPageVisionBlock(pageNo: number, body: string): string {
  const trimmed = sanitizePageVisionMarkdown(body).trim();
  return [
    pageVisionMarkerOpen(pageNo),
    trimmed,
    pageVisionMarkerClose(pageNo),
  ].join("\n");
}

/**
 * Collapse Gemini table-separator runaways (e.g. 100k+ dashes in one cell).
 * Safe to apply on write and on read for already-stored artifacts.
 */
export function sanitizePageVisionMarkdown(text: string): string {
  if (!text) return text;
  return text
    .replace(/:-{3,}/g, ":---")
    .replace(/-{3,}:/g, "---:")
    .replace(/-{20,}/g, "---");
}

/** True when output is mostly dash padding (token-burn runaway). */
export function isDegeneratePageVisionMarkdown(text: string): boolean {
  if (!text) return false;
  const dashes = (text.match(/-/g) ?? []).length;
  if (dashes < 400) return false;
  return dashes / text.length > 0.45;
}

const PAGE_BLOCK_RE =
  /<!-- (docling|vision):page=(\d+) -->\r?\n?[\s\S]*?<!-- \/\1:page=\2 -->/g;

type ExistingPageBlock = {
  pageNo: number;
  kind: "docling" | "vision";
  start: number;
  end: number;
};

function listPageBlocks(markdown: string): ExistingPageBlock[] {
  const blocks: ExistingPageBlock[] = [];
  const re = new RegExp(PAGE_BLOCK_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    const kind = match[1];
    const pageNo = Number(match[2]);
    if (kind !== "docling" && kind !== "vision") continue;
    if (!Number.isInteger(pageNo) || pageNo < 1) continue;
    blocks.push({
      kind,
      pageNo,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return blocks;
}

function joinMarkdownParts(before: string, block: string, after: string): string {
  const head = before.trimEnd();
  const tail = after.replace(/^\s*/, "");
  if (!head && !tail) return `${block}\n`;
  if (!head) return `${block}\n\n${tail}`;
  if (!tail) return `${head}\n\n${block}\n`;
  return `${head}\n\n${block}\n\n${tail}`;
}

/**
 * Splice a vision page into attachment markdown in page-number order.
 * Replaces an existing vision block for the same page; otherwise inserts
 * among `docling:page` / `vision:page` markers so a middle-page retry does
 * not append at the end of the document.
 */
export function spliceVisionPageIntoMarkdown(
  markdown: string,
  pageNo: number,
  visionBody: string,
): string {
  const block = formatPageVisionBlock(pageNo, visionBody);
  const blocks = listPageBlocks(markdown);

  const existingVision = blocks.find(
    (item) => item.kind === "vision" && item.pageNo === pageNo,
  );
  if (existingVision) {
    return joinMarkdownParts(
      markdown.slice(0, existingVision.start),
      block,
      markdown.slice(existingVision.end),
    );
  }

  const next = blocks.find((item) => item.pageNo > pageNo);
  if (!next) {
    const base = markdown.trimEnd();
    if (!base) return `${block}\n`;
    return `${base}\n\n${block}\n`;
  }

  return joinMarkdownParts(
    markdown.slice(0, next.start),
    block,
    markdown.slice(next.start),
  );
}

export type GeminiBillingHaltKind = "gemini_spend_cap" | "gemini_credits";

export type GeminiHttpErrorKind = GeminiBillingHaltKind | "gemini_rate_limit";

export class GeminiVisionQuotaError extends Error {
  readonly kind: GeminiBillingHaltKind;
  constructor(
    message = "Gemini monthly spending cap reached.",
    kind: GeminiBillingHaltKind = "gemini_spend_cap",
  ) {
    super(message);
    this.name = "GeminiVisionQuotaError";
    this.kind = kind;
  }
}

export type VisionErrorKind =
  | "gemini_spend_cap"
  | "gemini_credits"
  | "gemini_rate_limit"
  | "gemini_quota"
  | "gemini_fetch"
  | "encrypted_pdf"
  | "truncated"
  | "degenerate"
  | "stale"
  | "pdf_corrupt"
  | "other";

export const GEMINI_HTTP_ERROR_KINDS: VisionErrorKind[] = [
  "gemini_spend_cap",
  "gemini_credits",
  "gemini_rate_limit",
];

export function classifyGeminiHttpError(message: string): {
  kind: GeminiHttpErrorKind;
  label: string;
  fatal: boolean;
} | null {
  const m = message.trim();
  if (!m) return null;
  if (/exceeded its monthly spending cap/i.test(m)) {
    return {
      kind: "gemini_spend_cap",
      label: "Gemini monthly spending cap (429) — left pending",
      fatal: true,
    };
  }
  if (/prepayment credits? (are )?depleted|prepayment credit/i.test(m)) {
    return {
      kind: "gemini_credits",
      label: "Gemini prepaid credits depleted (429) — left pending",
      fatal: true,
    };
  }
  if (/429\s*Too Many Requests|RESOURCE_EXHAUSTED/i.test(m)) {
    return {
      kind: "gemini_rate_limit",
      label: "Gemini rate limit (429) — left pending",
      fatal: false,
    };
  }
  return null;
}

export function geminiBillingHaltMessage(kind: GeminiBillingHaltKind): string {
  if (kind === "gemini_credits") {
    return "Gemini prepaid credits are depleted — remaining vision pages left pending. Add credits or enable billing in AI Studio, then retry.";
  }
  return "Gemini monthly spending cap — remaining vision pages left pending. Raise the cap in AI Studio, then retry.";
}

/** True for spend-cap / prepaid-credit 429s (not RPM rate limits). */
export function isGeminiVisionQuotaMessage(message: string): boolean {
  return classifyGeminiHttpError(message)?.fatal === true;
}

export function isFatalGeminiVisionError(error: unknown): boolean {
  if (error instanceof GeminiVisionQuotaError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return isGeminiVisionQuotaMessage(message);
}

export function isGeminiBillingHaltKind(
  kind: VisionErrorKind | undefined,
): kind is GeminiBillingHaltKind {
  return kind === "gemini_spend_cap" || kind === "gemini_credits";
}

export function classifyVisionError(message: string): {
  kind: VisionErrorKind;
  label: string;
} {
  const m = message.trim() || "Page vision failed.";
  const http = classifyGeminiHttpError(m);
  if (http) {
    return { kind: http.kind, label: http.label };
  }
  if (/GoogleGenerativeAI/i.test(m) && /fetch failed/i.test(m)) {
    return { kind: "gemini_fetch", label: "Gemini fetch failed" };
  }
  if (/PDFDocument\.load/i.test(m) && /encrypted/i.test(m)) {
    return { kind: "encrypted_pdf", label: "Encrypted PDF" };
  }
  if (/truncated/i.test(m)) {
    return { kind: "truncated", label: "Vision output truncated" };
  }
  if (/degenerate/i.test(m)) {
    return { kind: "degenerate", label: "Vision output degenerate" };
  }
  if (/stale/i.test(m) || /Interrupted while processing/i.test(m)) {
    return { kind: "stale", label: "Interrupted (stale processing)" };
  }
  if (/PDFDict/i.test(m)) {
    return { kind: "pdf_corrupt", label: "Malformed PDF" };
  }
  return {
    kind: "other",
    label: m.length > 80 ? `${m.slice(0, 77)}…` : m,
  };
}

export function pageVisionBatchSizeFromEnv(): number {
  const raw = Number(process.env.PAGE_VISION_BATCH_SIZE ?? PAGE_VISION_BATCH_SIZE);
  if (!Number.isFinite(raw) || raw < 1) return PAGE_VISION_BATCH_SIZE;
  return Math.min(Math.floor(raw), 32);
}

export function pageVisionMaxAttemptsFromEnv(): number {
  const raw = Number(
    process.env.PAGE_VISION_MAX_ATTEMPTS ?? PAGE_VISION_MAX_ATTEMPTS,
  );
  if (!Number.isFinite(raw) || raw < 1) return PAGE_VISION_MAX_ATTEMPTS;
  return Math.floor(raw);
}

export function pageVisionStaleProcessingMsFromEnv(): number {
  const raw = Number(
    process.env.PAGE_VISION_STALE_PROCESSING_MS ??
      PAGE_VISION_STALE_PROCESSING_MS,
  );
  if (!Number.isFinite(raw) || raw < 60_000) {
    return PAGE_VISION_STALE_PROCESSING_MS;
  }
  return Math.floor(raw);
}

export function pageVisionRateLimitBackoffMsFromEnv(): number {
  const raw = Number(
    process.env.PAGE_VISION_RATE_LIMIT_BACKOFF_MS ??
      PAGE_VISION_RATE_LIMIT_BACKOFF_MS,
  );
  if (!Number.isFinite(raw) || raw < 1_000) {
    return PAGE_VISION_RATE_LIMIT_BACKOFF_MS;
  }
  return Math.min(Math.floor(raw), 120_000);
}

export function pageVisionRateLimitMaxRoundsFromEnv(): number {
  const raw = Number(
    process.env.PAGE_VISION_RATE_LIMIT_MAX_ROUNDS ??
      PAGE_VISION_RATE_LIMIT_MAX_ROUNDS,
  );
  if (!Number.isFinite(raw) || raw < 1) return PAGE_VISION_RATE_LIMIT_MAX_ROUNDS;
  return Math.min(Math.floor(raw), 20);
}
