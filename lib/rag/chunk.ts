import crypto from "crypto";

export type CorpusChunk = {
  chunkIndex: number;
  chunkText: string;
  charStart: number;
  charEnd: number;
  contentHashDedup: string;
};

export type ChunkingOptions = {
  minChars?: number;
  maxChars?: number;
  overlapChars?: number;
};

const DEFAULT_MIN_CHARS = 400;
const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 100;

export function hashChunkText(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

/**
 * Split text into semantic chunks respecting paragraph and sentence boundaries.
 */
export function chunkText(
  text: string,
  options?: ChunkingOptions,
): CorpusChunk[] {
  const minChars = options?.minChars ?? DEFAULT_MIN_CHARS;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options?.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  if (normalized.length <= maxChars) {
    return [
      {
        chunkIndex: 0,
        chunkText: normalized,
        charStart: 0,
        charEnd: normalized.length,
        contentHashDedup: hashChunkText(normalized),
      },
    ];
  }

  // Split on markdown headings or paragraph boundaries
  const rawParagraphs = normalized.split(/(?<=\n)(?=#{1,6}\s)|\n\s*\n+/);
  const units: Array<{ text: string; start: number; end: number }> = [];

  let searchIndex = 0;
  for (const raw of rawParagraphs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const startPos = normalized.indexOf(trimmed, searchIndex);
    const actualStart = startPos >= 0 ? startPos : searchIndex;
    const actualEnd = actualStart + trimmed.length;
    searchIndex = actualEnd;

    if (trimmed.length <= maxChars) {
      units.push({ text: trimmed, start: actualStart, end: actualEnd });
    } else {
      // Split paragraph by sentences
      const sentenceParts = trimmed.split(/(?<=[.!?…])\s+/);
      let sSearch = actualStart;
      for (const sent of sentenceParts) {
        const sTrim = sent.trim();
        if (!sTrim) continue;
        const sPos = normalized.indexOf(sTrim, sSearch);
        const sStart = sPos >= 0 ? sPos : sSearch;
        const sEnd = sStart + sTrim.length;
        sSearch = sEnd;

        if (sTrim.length <= maxChars) {
          units.push({ text: sTrim, start: sStart, end: sEnd });
        } else {
          // Fallback: split long sentences on whitespace
          let wRemaining = sTrim;
          let wOffset = sStart;
          while (wRemaining.length > maxChars) {
            const window = wRemaining.slice(0, maxChars + 1);
            let breakAt = window.lastIndexOf(" ");
            if (breakAt < Math.floor(maxChars * 0.4)) {
              breakAt = maxChars;
            }
            const piece = wRemaining.slice(0, breakAt).trim();
            if (piece) {
              units.push({
                text: piece,
                start: wOffset,
                end: wOffset + piece.length,
              });
            }
            wRemaining = wRemaining.slice(breakAt).trim();
            wOffset += breakAt;
          }
          if (wRemaining.length > 0) {
            units.push({
              text: wRemaining,
              start: wOffset,
              end: wOffset + wRemaining.length,
            });
          }
        }
      }
    }
  }

  if (units.length === 0) return [];

  // Pack units into chunks of minChars .. maxChars
  const chunks: CorpusChunk[] = [];
  let currentUnitIndices: number[] = [];
  let currentLength = 0;

  function flushChunk() {
    if (currentUnitIndices.length === 0) return;
    const firstIdx = currentUnitIndices[0];
    const lastIdx = currentUnitIndices[currentUnitIndices.length - 1];
    const chunkStart = units[firstIdx].start;
    const chunkEnd = units[lastIdx].end;
    const chunkText = normalized.slice(chunkStart, chunkEnd).trim();

    if (chunkText.length >= 20) {
      chunks.push({
        chunkIndex: chunks.length,
        chunkText,
        charStart: chunkStart,
        charEnd: chunkEnd,
        contentHashDedup: hashChunkText(chunkText),
      });
    }

    // Determine overlap for next chunk
    if (overlapChars > 0 && currentUnitIndices.length > 1) {
      let overlapLen = 0;
      const retained: number[] = [];
      for (let i = currentUnitIndices.length - 1; i >= 0; i--) {
        const uIdx = currentUnitIndices[i];
        overlapLen += units[uIdx].text.length;
        retained.unshift(uIdx);
        if (overlapLen >= overlapChars) break;
      }
      if (retained.length < currentUnitIndices.length) {
        currentUnitIndices = retained;
        currentLength = overlapLen;
        return;
      }
    }

    currentUnitIndices = [];
    currentLength = 0;
  }

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (currentLength + unit.text.length + 1 > maxChars && currentLength >= minChars) {
      flushChunk();
    }
    currentUnitIndices.push(i);
    currentLength += unit.text.length + 1;
  }

  flushChunk();
  return chunks;
}

export type EmailForChunking = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  threadId: string | null;
  bodyText: string;
  bodyTextUnique?: string | null;
};

/**
 * Prepares chunks and metadata for an email body.
 */
export function chunkEmailBody(email: EmailForChunking): {
  chunks: CorpusChunk[];
  metadata: Record<string, unknown>;
} {
  const body =
    email.bodyTextUnique?.trim() ||
    email.bodyText?.trim() ||
    "";

  const metadata = {
    sourceKind: "email_body",
    emailId: email.id,
    subject: email.subject || "(no subject)",
    fromAddress: email.fromAddress || "",
    receivedAt: email.receivedAt || "",
    threadId: email.threadId || null,
  };

  const chunks = chunkText(body);
  return { chunks, metadata };
}

export type AttachmentForChunking = {
  contentHash: string;
  attachmentId?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  emailId?: string | null;
  receivedAt?: string | null;
  subject?: string | null;
};

/**
 * Prepares chunks and metadata for parsed attachment markdown.
 */
export function chunkAttachmentMarkdown(
  attachment: AttachmentForChunking,
  markdownText: string,
): {
  chunks: CorpusChunk[];
  metadata: Record<string, unknown>;
} {
  const metadata = {
    sourceKind: "attachment_markdown",
    contentHash: attachment.contentHash,
    attachmentId: attachment.attachmentId || null,
    filename: attachment.filename || "attachment",
    mimeType: attachment.mimeType || "application/octet-stream",
    emailId: attachment.emailId || null,
    subject: attachment.subject || null,
    receivedAt: attachment.receivedAt || null,
  };

  const chunks = chunkText(markdownText);
  return { chunks, metadata };
}

export type VisionPageForChunking = {
  contentHash: string;
  pageNo: number;
  attachmentId?: string | null;
  filename?: string | null;
  emailId?: string | null;
  receivedAt?: string | null;
  subject?: string | null;
};

/**
 * Prepares chunks and metadata for a completed vision page.
 */
export function chunkVisionPage(
  page: VisionPageForChunking,
  pageMarkdown: string,
): {
  chunks: CorpusChunk[];
  metadata: Record<string, unknown>;
} {
  const metadata = {
    sourceKind: "attachment_vision_page",
    contentHash: page.contentHash,
    pageNo: page.pageNo,
    attachmentId: page.attachmentId || null,
    filename: page.filename || "attachment",
    emailId: page.emailId || null,
    subject: page.subject || null,
    receivedAt: page.receivedAt || null,
  };

  const chunks = chunkText(pageMarkdown);
  return { chunks, metadata };
}
