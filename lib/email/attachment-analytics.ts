import { and, eq, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailAttachments, emails } from "@/lib/db/schema";
import {
  attachmentKind,
  attachmentKindLabel,
} from "@/lib/email/attachment-display";
import { countAttachmentPages } from "@/lib/email/attachment-page-count";
import { getAttachmentDownloadStatus } from "@/lib/email/attachment-download";
import {
  readCachedAttachment,
} from "@/lib/gmail/attachments";
import type { EmailThreadFilters } from "@/lib/email/thread-filters";
import { buildThreadFilterWhere } from "@/lib/email/thread-filters";

import type {
  AttachmentAnalytics,
  AttachmentTypeStat,
} from "@/lib/email/attachment-analytics-types";

const BACKFILL_BATCH_SIZE = 100;

type AttachmentRow = {
  id: string;
  mimeType: string;
  sizeBytes: number | null;
  pageCount: number | null;
  contentHash: string | null;
  cachedFilePath: string | null;
};

function extensionFromCachedPath(cachedFilePath: string): string {
  const match = cachedFilePath.match(/\.[^.]+$/);
  return match?.[0] ?? ".bin";
}

async function backfillMissingPageCounts(
  rows: AttachmentRow[],
): Promise<Map<string, number>> {
  const updated = new Map<string, number>();
  const pending = rows.filter(
    (row) =>
      attachmentKind(row.mimeType) === "pdf" &&
      row.pageCount == null &&
      row.contentHash &&
      row.cachedFilePath,
  );

  if (pending.length === 0) return updated;

  const db = getDb();
  const maxBatches = 10;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const batch = pending
      .filter((row) => !updated.has(row.id))
      .slice(0, BACKFILL_BATCH_SIZE);

    if (batch.length === 0) break;

    for (const row of batch) {
      const ext = extensionFromCachedPath(row.cachedFilePath!);
      const bytes = await readCachedAttachment(row.contentHash!, ext);
      if (!bytes) continue;

      const pageCount = await countAttachmentPages(bytes, row.mimeType);
      if (pageCount == null) continue;

      await db
        .update(emailAttachments)
        .set({ pageCount })
        .where(eq(emailAttachments.id, row.id));

      updated.set(row.id, pageCount);
    }
  }

  return updated;
}

function buildAttachmentFilterWhere(
  filters: EmailThreadFilters,
): SQL | undefined {
  const emailFilter = buildThreadFilterWhere(filters);
  if (!emailFilter) return undefined;
  return and(
    eq(emailAttachments.emailId, emails.id),
    emailFilter,
  );
}

function aggregateByType(
  rows: AttachmentRow[],
  pageCountOverrides: Map<string, number>,
): AttachmentAnalytics {
  const buckets = new Map<
    ReturnType<typeof attachmentKind>,
    AttachmentTypeStat
  >();

  for (const row of rows) {
    const kind = attachmentKind(row.mimeType);
    const pageCount =
      pageCountOverrides.get(row.id) ?? row.pageCount ?? null;
    const isCached = Boolean(row.contentHash && row.cachedFilePath);
    const supportsPages = kind === "pdf";

    let stat = buckets.get(kind);
    if (!stat) {
      stat = {
        kind,
        label: attachmentKindLabel(kind),
        count: 0,
        totalSizeBytes: 0,
        totalPages: supportsPages ? 0 : null,
        uncachedCount: 0,
        pendingPageCount: 0,
      };
      buckets.set(kind, stat);
    }

    stat.count += 1;
    stat.totalSizeBytes += row.sizeBytes ?? 0;

    if (supportsPages) {
      if (pageCount != null) {
        stat.totalPages = (stat.totalPages ?? 0) + pageCount;
      } else if (!isCached) {
        stat.uncachedCount += 1;
      } else {
        stat.pendingPageCount += 1;
      }
    }
  }

  const byType = [...buckets.values()].sort((a, b) => b.count - a.count);
  const totalAttachments = rows.length;
  const totalSizeBytes = byType.reduce(
    (sum, stat) => sum + stat.totalSizeBytes,
    0,
  );
  const pdfStat = byType.find((stat) => stat.kind === "pdf");
  const pageCountComplete =
    !pdfStat || (pdfStat.uncachedCount === 0 && pdfStat.pendingPageCount === 0);
  const totalPages = pdfStat?.totalPages ?? null;

  return {
    totalAttachments,
    totalSizeBytes,
    totalPages,
    uncachedTotal: 0,
    byType,
    pageCountComplete,
    filtersActive: false,
    parseStatus: null,
  };
}

export async function loadAttachmentAnalytics(
  filters: EmailThreadFilters,
  filtersActive: boolean,
): Promise<AttachmentAnalytics> {
  const db = getDb();
  const filterWhere = buildAttachmentFilterWhere(filters);

  const baseQuery = db
    .select({
      id: emailAttachments.id,
      mimeType: emailAttachments.mimeType,
      sizeBytes: emailAttachments.sizeBytes,
      pageCount: emailAttachments.pageCount,
      contentHash: emailAttachments.contentHash,
      cachedFilePath: emailAttachments.cachedFilePath,
    })
    .from(emailAttachments);

  const rows: AttachmentRow[] = filterWhere
    ? await baseQuery
        .innerJoin(emails, eq(emailAttachments.emailId, emails.id))
        .where(filterWhere)
    : await baseQuery;

  const pageCountOverrides = await backfillMissingPageCounts(rows);
  const analytics = aggregateByType(rows, pageCountOverrides);
  const downloadStatus = await getAttachmentDownloadStatus();
  analytics.uncachedTotal = downloadStatus.remaining;
  analytics.filtersActive = filtersActive;

  try {
    const { getAttachmentParseStatus } = await import(
      "@/lib/email/attachment-markdown"
    );
    analytics.parseStatus = await getAttachmentParseStatus();
  } catch (error) {
    console.warn(
      "[attachment-analytics] Could not load parse status:",
      error instanceof Error ? error.message : error,
    );
  }

  return analytics;
}
