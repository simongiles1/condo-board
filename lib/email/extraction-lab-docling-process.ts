/**
 * Docling + vision path for Extraction lab "Process selected" (replaces Cloudflare toMarkdown).
 */

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  attachmentDocumentPages,
  attachmentDocuments,
} from "@/lib/db/schema";
import {
  DEFAULT_DOCLING_PROVIDER,
  type DoclingProvider,
} from "@/lib/email/docling-provider";
import {
  convertDoclingPages,
  listUncachedTextRoutePages,
} from "@/lib/email/docling-lab";
import { requeueFailedVisionPagesForHash } from "@/lib/email/extraction-backfill-plan";
import { promoteParsedIfExtractionComplete } from "@/lib/email/extraction-parse-promote";
import {
  processVisionForDocument,
  type PageVisionBatchResult,
} from "@/lib/email/page-vision";

const SIDECAR_PAGE_CHUNK = 5;
const IBM_PAGE_CHUNK = 5;

function chunkPages(pages: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pages.length; i += size) {
    out.push(pages.slice(i, i + size));
  }
  return out;
}

export type LabDoclingProcessOutcome = {
  doclingRan: boolean;
  doclingCostUsd: number;
  vision: PageVisionBatchResult | null;
  visionCostUsd: number;
};

/** Drop legacy Cloudflare parse failures when page-profile extraction takes over. */
async function clearLegacyCloudflareParseFailure(
  contentHash: string,
): Promise<void> {
  const db = getDb();
  const [doc] = await db
    .select({
      parseStatus: attachmentDocuments.parseStatus,
      parseError: attachmentDocuments.parseError,
    })
    .from(attachmentDocuments)
    .where(eq(attachmentDocuments.contentHash, contentHash))
    .limit(1);
  if (doc?.parseStatus !== "failed") return;

  const [pageRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attachmentDocumentPages)
    .where(eq(attachmentDocumentPages.contentHash, contentHash));
  if (Number(pageRow?.n) === 0) return;

  const err = doc.parseError?.trim() ?? "";
  const legacyCf =
    /CLOUDFLARE_/i.test(err) ||
    /toMarkdown/i.test(err) ||
    err.includes("attachment Markdown conversion");
  if (!legacyCf && err) return;

  await db
    .update(attachmentDocuments)
    .set({ parseStatus: "pending", parseError: null })
    .where(eq(attachmentDocuments.contentHash, contentHash));
}

export async function processLabDocumentWithDocling(
  contentHash: string,
  provider: DoclingProvider = DEFAULT_DOCLING_PROVIDER,
): Promise<LabDoclingProcessOutcome> {
  await clearLegacyCloudflareParseFailure(contentHash);

  const uncached = await listUncachedTextRoutePages(contentHash);
  let doclingRan = false;
  let doclingCostUsd = 0;

  if (uncached.length > 0) {
    const chunkSize = provider === "ibm" ? IBM_PAGE_CHUNK : SIDECAR_PAGE_CHUNK;
    for (const group of chunkPages(uncached, chunkSize)) {
      const result = await convertDoclingPages({
        contentHash,
        pages: group,
        provider,
      });
      const freshPages = result.pages.filter((page) => !page.cached).length;
      if (freshPages > 0) doclingRan = true;
      doclingCostUsd += result.costUsd;
    }
  }

  await requeueFailedVisionPagesForHash(contentHash);

  const db = getDb();
  const pendingPages = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from attachment_document_pages
    where content_hash = ${contentHash}
      and vision_status in ('pending', 'failed')
  `);
  const pendingN = Number(pendingPages.rows?.[0]?.n ?? 0);

  let vision: PageVisionBatchResult | null = null;
  let visionCostUsd = 0;
  if (pendingN > 0) {
    vision = await processVisionForDocument({ contentHash });
    visionCostUsd = vision.costUsd;
  }

  await promoteParsedIfExtractionComplete(contentHash);

  return {
    doclingRan,
    doclingCostUsd,
    vision,
    visionCostUsd,
  };
}
