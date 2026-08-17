import type { attachmentKind } from "@/lib/email/attachment-display";

export type AttachmentTypeStat = {
  kind: ReturnType<typeof attachmentKind>;
  label: string;
  count: number;
  totalSizeBytes: number;
  /** Sum of known page counts; null when this type is not pageable. */
  totalPages: number | null;
  /** PDFs not yet downloaded — page count unknown until opened. */
  uncachedCount: number;
  /** Downloaded PDFs where page count has not been computed yet. */
  pendingPageCount: number;
};

export type AttachmentParseStatusSummary = {
  pending: number;
  parsing: number;
  parsed: number;
  needsOcr: number;
  unsupported: number;
  failed: number;
  total: number;
};

export type AttachmentParseBatchResult = {
  processed: number;
  parsed: number;
  needsOcr: number;
  unsupported: number;
  failed: number;
  skipped: number;
  remaining: number;
  lastError: string | null;
};

export type AttachmentAnalytics = {
  totalAttachments: number;
  totalSizeBytes: number;
  totalPages: number | null;
  /** Attachments not yet downloaded from Gmail. */
  uncachedTotal: number;
  byType: AttachmentTypeStat[];
  pageCountComplete: boolean;
  filtersActive: boolean;
  /** Markdown conversion substrate status (content-hash deduped). */
  parseStatus: AttachmentParseStatusSummary | null;
};

export type AttachmentDownloadBatchResult = {
  downloaded: number;
  failed: number;
  total: number;
  cached: number;
  remaining: number;
  lastError: string | null;
};

export function formatAnalyticsSize(sizeBytes: number): string {
  if (sizeBytes <= 0) return "0 B";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
