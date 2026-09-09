import { and, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { documentChunks } from "@/lib/db/schema";
import { emailMessageDetailHref } from "@/lib/email/thread-filters";
import { summarizeEmbeddingUsage } from "@/lib/rag/cost";
import { embedQuery } from "@/lib/rag/embed";
import {
  enrichSearchWithRegistry,
  type CorpusSearchEntityBadge,
  type MatchedRegistryEntity,
} from "@/lib/rag/registry-boost";

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
  rawSimilarity: number;
  boost: number;
  entities: CorpusSearchEntityBadge[];
};

export type CorpusSearchUsage = {
  inputTokens: number;
  costUsd: number;
  tokenSource: "api" | "estimate";
};

export type CorpusSearchResponse = {
  results: CorpusSearchResult[];
  matchedEntities: MatchedRegistryEntity[];
  usage: CorpusSearchUsage;
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
): Promise<CorpusSearchResponse> {
  const query = options.query.trim();
  if (!query) {
    return {
      results: [],
      matchedEntities: [],
      usage: { inputTokens: 0, costUsd: 0, tokenSource: "estimate" },
    };
  }

  const limit = Math.max(1, Math.min(50, options.limit ?? 10));
  const candidateLimit = Math.min(50, Math.max(limit * 3, limit));
  const minSimilarity = options.minSimilarity ?? 0.2;
  const sourceKind = options.sourceKind ?? "all";

  const embedded = await embedQuery(query);
  const queryVector = embedded.vector;
  const usage = summarizeEmbeddingUsage(embedded.usage);
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
    .limit(candidateLimit);

  const mapped: CorpusSearchResult[] = rows.map((row) => {
    let metadata: CorpusSearchResult["metadata"] = {};
    try {
      metadata = JSON.parse(row.metadataJson || "{}");
    } catch {
      metadata = {};
    }

    let sourceLink: string | null = null;
    let emailLink: string | null = null;

    if (row.emailId) {
      emailLink = emailMessageDetailHref(row.emailId);
    }

    if (row.sourceKind === "email_body") {
      sourceLink = emailLink;
    } else if (metadata.attachmentId) {
      sourceLink = `/api/email/attachments/${metadata.attachmentId}`;
    }

    const similarity = Number(row.similarity.toFixed(4));
    return {
      id: row.id,
      sourceKind: row.sourceKind as CorpusSearchResult["sourceKind"],
      emailId: row.emailId,
      contentHash: row.contentHash,
      pageNo: row.pageNo,
      chunkIndex: row.chunkIndex,
      chunkText: row.chunkText,
      similarity,
      excerpt: extractExcerpt(row.chunkText, query),
      metadata,
      sourceLink,
      emailLink,
      rawSimilarity: similarity,
      boost: 0,
      entities: [],
    };
  });

  try {
    const enriched = await enrichSearchWithRegistry({
      query,
      results: mapped,
      limit,
    });
    return {
      results: enriched.results,
      matchedEntities: enriched.matchedEntities,
      usage,
    };
  } catch (err) {
    console.error("[corpus-search] registry boost failed:", err);
    return {
      results: mapped.slice(0, limit),
      matchedEntities: [],
      usage,
    };
  }
}
