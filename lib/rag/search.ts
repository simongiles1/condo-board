import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { documentChunks } from "@/lib/db/schema";
import { embedQuery } from "@/lib/rag/embed";

export type CorpusSearchOptions = {
  query: string;
  limit?: number;
  minSimilarity?: number;
  sourceKind?: "email_body" | "attachment_markdown" | "attachment_vision_page" | "all";
};

export type CorpusSearchResult = {
  id: string;
  sourceKind: "email_body" | "attachment_markdown" | "attachment_vision_page";
  emailId: string | null;
  contentHash: string | null;
  pageNo: number | null;
  chunkIndex: number;
  chunkText: string;
  similarity: number;
  excerpt: string;
  metadata: {
    subject?: string;
    fromAddress?: string;
    receivedAt?: string;
    filename?: string;
    threadId?: string | null;
    attachmentId?: string | null;
    mimeType?: string;
    [key: string]: unknown;
  };
  sourceLink: string | null;
  emailLink: string | null;
};

/**
 * Cleanly extracts an excerpt around query terms.
 */
export function extractExcerpt(
  text: string,
  query: string,
  maxLength = 280,
): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length <= maxLength) return normalizedText;

  const loweredText = normalizedText.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9$]+/g)
    .filter((t) => t.length >= 2);

  let bestIndex = -1;
  let bestScore = 0;

  // Search full phrase first
  const fullIdx = loweredText.indexOf(query.toLowerCase().trim());
  if (fullIdx >= 0) {
    bestIndex = fullIdx;
    bestScore = 100;
  } else {
    for (const token of tokens) {
      const idx = loweredText.indexOf(token);
      if (idx >= 0) {
        const score = token.length >= 5 ? 5 : 2;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = idx;
        }
      }
    }
  }

  if (bestIndex < 0) {
    return normalizedText.slice(0, maxLength) + "…";
  }

  const prefixPadding = 80;
  let start = Math.max(0, bestIndex - prefixPadding);
  // Snap to word boundary
  if (start > 0) {
    const spaceIdx = normalizedText.indexOf(" ", start);
    if (spaceIdx >= 0 && spaceIdx < start + 20) {
      start = spaceIdx + 1;
    }
  }

  let end = Math.min(normalizedText.length, start + maxLength);
  if (end < normalizedText.length) {
    const spaceIdx = normalizedText.lastIndexOf(" ", end);
    if (spaceIdx >= start + maxLength - 40) {
      end = spaceIdx;
    }
  }

  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalizedText.length ? "…" : "";
  return prefix + normalizedText.slice(start, end).trim() + suffix;
}

/**
 * Searches the vector corpus by cosine similarity.
 */
export async function searchCorpus(
  options: CorpusSearchOptions,
): Promise<CorpusSearchResult[]> {
  const query = options.query.trim();
  if (!query) return [];

  const limit = Math.max(1, Math.min(50, options.limit ?? 10));
  const minSimilarity = options.minSimilarity ?? 0.2;
  const sourceKind = options.sourceKind ?? "all";

  const queryVector = await embedQuery(query);
  const vectorStr = `[${queryVector.join(",")}]`;

  const db = getDb();
  const similarityExpr = sql<number>`1 - (${documentChunks.embedding} <=> ${vectorStr}::vector)`;
  const distanceExpr = sql<number>`${documentChunks.embedding} <=> ${vectorStr}::vector`;

  const conditions = [
    isNotNull(documentChunks.embedding),
    sql`${similarityExpr} >= ${minSimilarity}`,
  ];

  if (sourceKind !== "all") {
    conditions.push(eq(documentChunks.sourceKind, sourceKind));
  }

  const rows = await db
    .select({
      id: documentChunks.id,
      sourceKind: documentChunks.sourceKind,
      emailId: documentChunks.emailId,
      contentHash: documentChunks.contentHash,
      pageNo: documentChunks.pageNo,
      chunkIndex: documentChunks.chunkIndex,
      chunkText: documentChunks.chunkText,
      metadataJson: documentChunks.metadataJson,
      similarity: similarityExpr,
    })
    .from(documentChunks)
    .where(and(...conditions))
    .orderBy(distanceExpr)
    .limit(limit);

  return rows.map((row) => {
    let metadata: CorpusSearchResult["metadata"] = {};
    try {
      metadata = JSON.parse(row.metadataJson || "{}");
    } catch {
      metadata = {};
    }

    let sourceLink: string | null = null;
    let emailLink: string | null = null;

    if (row.emailId) {
      emailLink = `/knowledge/emails/${row.emailId}`;
    }

    if (row.sourceKind === "email_body") {
      sourceLink = emailLink;
    } else if (metadata.attachmentId) {
      sourceLink = `/api/email/attachments/${metadata.attachmentId}`;
    }

    return {
      id: row.id,
      sourceKind: row.sourceKind as CorpusSearchResult["sourceKind"],
      emailId: row.emailId,
      contentHash: row.contentHash,
      pageNo: row.pageNo,
      chunkIndex: row.chunkIndex,
      chunkText: row.chunkText,
      similarity: Number(row.similarity.toFixed(4)),
      excerpt: extractExcerpt(row.chunkText, query),
      metadata,
      sourceLink,
      emailLink,
    };
  });
}
