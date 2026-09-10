import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { documentChunks, emailAttachments, emails } from "@/lib/db/schema";
import { emailMessageDetailHref } from "@/lib/email/thread-filters";
import { summarizeEmbeddingUsage } from "@/lib/rag/cost";
import { embedQuery } from "@/lib/rag/embed";
import {
  FILENAME_ALIAS_SIMILARITY,
  FILENAME_MATCH_SIMILARITY,
  MAX_FILENAME_ATTACHMENT_HITS,
  coveringEmailQueryOverlap,
  extractFileLikeNames,
  filenameMatchesAlias,
  filenameMatchesQuery,
  filenameSearchNeedles,
  isFileSeekingQuery,
} from "@/lib/rag/filename-match";
import {
  rewriteCorpusQuery,
  type CorpusQueryRewrite,
  type CorpusRewriteUsage,
} from "@/lib/rag/query-rewrite";
import {
  loadCorpusSearchFileCards,
  type CorpusSearchFileCard,
} from "@/lib/rag/file-card-runs";
import {
  enrichSearchWithRegistry,
  type CorpusSearchEntityBadge,
  type MatchedRegistryEntity,
} from "@/lib/rag/registry-boost";

export type { CorpusSearchFileCard };

export type CorpusSearchOptions = {
  query: string;
  limit?: number;
  minSimilarity?: number;
  sourceKind?: "email_body" | "attachment_markdown" | "attachment_vision_page" | "all";
  /** Default true: LLM expands the question before retrieval. */
  rewriteQuery?: boolean;
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
  /** Structured file-card summary from the extraction lab (when generated). */
  fileCard?: CorpusSearchFileCard;
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
  rewrite?: CorpusQueryRewrite;
  rewriteUsage?: CorpusRewriteUsage;
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

const EMPTY_SEARCH_USAGE: CorpusSearchUsage = {
  inputTokens: 0,
  costUsd: 0,
  tokenSource: "estimate",
};

type MappedChunkRow = {
  id: string;
  sourceKind: string;
  emailId: string | null;
  contentHash: string | null;
  pageNo: number | null;
  chunkIndex: number;
  chunkText: string;
  metadataJson: string;
  similarity: number;
};

function mapChunkRowToResult(
  row: MappedChunkRow,
  query: string,
): CorpusSearchResult {
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
}

function syntheticFilenameResult(params: {
  query: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  contentHash: string | null;
  emailId: string;
  subject: string | null;
  fromAddress: string;
  receivedAt: string;
  threadId: string | null;
  similarity?: number;
}): CorpusSearchResult {
  const similarity = params.similarity ?? FILENAME_MATCH_SIMILARITY;
  const chunkText = [
    `File: ${params.filename}`,
    params.subject ? `Email: ${params.subject}` : null,
    `Received: ${params.receivedAt}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `filename:${params.attachmentId}`,
    sourceKind: "attachment_markdown",
    emailId: params.emailId,
    contentHash: params.contentHash,
    pageNo: null,
    chunkIndex: 0,
    chunkText,
    similarity,
    excerpt: extractExcerpt(chunkText, params.query),
    metadata: {
      filename: params.filename,
      mimeType: params.mimeType,
      attachmentId: params.attachmentId,
      emailId: params.emailId,
      subject: params.subject ?? undefined,
      fromAddress: params.fromAddress,
      receivedAt: params.receivedAt,
      threadId: params.threadId,
      filenameMatch: true,
    },
    sourceLink: `/api/email/attachments/${params.attachmentId}`,
    emailLink: emailMessageDetailHref(params.emailId),
    rawSimilarity: similarity,
    boost: 0,
    entities: [],
  };
}

function mergeSearchResults(
  filenameHits: CorpusSearchResult[],
  vectorHits: CorpusSearchResult[],
): CorpusSearchResult[] {
  const byId = new Map<string, CorpusSearchResult>();

  for (const hit of filenameHits) {
    byId.set(hit.id, hit);
  }

  for (const hit of vectorHits) {
    const existing = byId.get(hit.id);
    if (existing) {
      const similarity = Math.max(existing.similarity, hit.similarity);
      byId.set(hit.id, {
        ...hit,
        similarity,
        rawSimilarity: similarity,
        metadata: { ...hit.metadata, ...existing.metadata },
      });
      continue;
    }
    byId.set(hit.id, hit);
  }

  return [...byId.values()].sort((a, b) => b.similarity - a.similarity);
}

export function isLexicalFilenameHit(result: CorpusSearchResult): boolean {
  return (
    result.metadata.filenameMatch === true ||
    result.metadata.filenameAlias === true
  );
}

/** Candidate pool size for ask: the model judges this set, then the answerer reads the top files. */
export const ASK_RETRIEVAL_LIMIT = 40;

/**
 * Take `count` items spread across a ranked list (head, middle, and tail).
 * Used so a later filename match is not dropped only because it scored lower.
 */
export function spreadTake<T>(items: T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return items;
  const used = new Set<number>();
  const indexes: number[] = [];
  const last = items.length - 1;
  const steps = Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const index = Math.round((i * last) / steps);
    if (!used.has(index)) {
      used.add(index);
      indexes.push(index);
    }
  }
  for (let i = last; i >= 0 && indexes.length < count; i--) {
    if (!used.has(i)) {
      used.add(i);
      indexes.push(i);
    }
  }
  return indexes.sort((a, b) => a - b).map((index) => items[index]);
}

/**
 * Keep filename hits in the candidate pool so dense retrieval cannot drop
 * files found by name. Does not prefer document types (signed, draft, …).
 */
export function selectHybridResults(
  results: CorpusSearchResult[],
  limit: number,
): CorpusSearchResult[] {
  if (results.length <= limit) return results;

  const lexical = results.filter(isLexicalFilenameHit);
  const otherCount = results.length - lexical.length;
  const otherSlots = Math.min(otherCount, Math.max(5, Math.floor(limit / 5)));
  const reserved = Math.min(lexical.length, Math.max(0, limit - otherSlots));
  const lexicalKeep = spreadTake(lexical, reserved);
  const kept = new Set(lexicalKeep.map((row) => row.id));
  const fill = results
    .filter((row) => !kept.has(row.id))
    .slice(0, Math.max(0, limit - lexicalKeep.length));
  const chosen = new Set([
    ...lexicalKeep.map((row) => row.id),
    ...fill.map((row) => row.id),
  ]);
  return results.filter((row) => chosen.has(row.id)).slice(0, limit);
}

async function loadFilenameMatchedResults(
  query: string,
  sourceKind: NonNullable<CorpusSearchOptions["sourceKind"]>,
  extraNeedles: string[] = [],
): Promise<CorpusSearchResult[]> {
  if (sourceKind === "email_body") return [];

  const needles = filenameSearchNeedles(query, extraNeedles);
  if (needles.length === 0) return [];

  const db = getDb();
  const likeFilters = needles.map(
    (needle) =>
      sql`lower(${emailAttachments.filename}) like ${`%${needle.toLowerCase()}%`}`,
  );

  const attachmentRows = await db
    .select({
      attachmentId: emailAttachments.id,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      contentHash: emailAttachments.contentHash,
      emailId: emailAttachments.emailId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      threadId: emails.threadId,
      bodyTextUnique: emails.bodyTextUnique,
    })
    .from(emailAttachments)
    .innerJoin(emails, eq(emails.id, emailAttachments.emailId))
    .where(or(...likeFilters))
    .limit(80);

  const fileLikeNeedles = extractFileLikeNames(query).map((name) =>
    name.toLowerCase(),
  );
  const scoreFilenameRow = (row: (typeof attachmentRows)[number]) => {
    const lower = row.filename.toLowerCase();
    if (fileLikeNeedles.includes(lower)) return 100;
    if (fileLikeNeedles.some((name) => lower.includes(name))) return 50;
    if (filenameMatchesQuery(row.filename, query)) return 20;
    return coveringEmailQueryOverlap(
      query,
      row.subject,
      row.bodyTextUnique,
      extraNeedles,
    );
  };
  const filtered = attachmentRows.filter(
    (row) =>
      filenameMatchesQuery(row.filename, query) ||
      filenameMatchesAlias(row.filename, extraNeedles),
  );
  if (filtered.length === 0) return [];
  const ranked = [...filtered].sort(
    (a, b) => scoreFilenameRow(b) - scoreFilenameRow(a),
  );
  const uniqueRows: typeof ranked = [];
  const seenKeys = new Set<string>();
  for (const row of ranked) {
    const key = row.contentHash || row.attachmentId;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueRows.push(row);
  }
  const matched = spreadTake(uniqueRows, MAX_FILENAME_ATTACHMENT_HITS);
  if (matched.length === 0) return [];

  const hashes = [
    ...new Set(
      matched
        .map((row) => row.contentHash)
        .filter((hash): hash is string => Boolean(hash)),
    ),
  ];

  const chunkByHash = new Map<string, MappedChunkRow>();
  if (hashes.length > 0) {
    const chunkConditions = [
      inArray(documentChunks.contentHash, hashes),
      eq(documentChunks.chunkIndex, 0),
    ];
    if (sourceKind !== "all") {
      chunkConditions.push(eq(documentChunks.sourceKind, sourceKind));
    }

    const chunkRows = await db
      .select({
        id: documentChunks.id,
        sourceKind: documentChunks.sourceKind,
        emailId: documentChunks.emailId,
        contentHash: documentChunks.contentHash,
        pageNo: documentChunks.pageNo,
        chunkIndex: documentChunks.chunkIndex,
        chunkText: documentChunks.chunkText,
        metadataJson: documentChunks.metadataJson,
      })
      .from(documentChunks)
      .where(and(...chunkConditions));

    const kindRank = (kind: string) =>
      kind === "attachment_markdown"
        ? 0
        : kind === "attachment_vision_page"
          ? 1
          : 2;

    for (const row of chunkRows) {
      if (!row.contentHash) continue;
      const existing = chunkByHash.get(row.contentHash);
      if (!existing || kindRank(row.sourceKind) < kindRank(existing.sourceKind)) {
        chunkByHash.set(row.contentHash, {
          ...row,
          similarity: FILENAME_MATCH_SIMILARITY,
        });
      }
    }
  }

  const results: CorpusSearchResult[] = [];
  const usedHashes = new Set<string>();

  for (const row of matched) {
    if (results.length >= MAX_FILENAME_ATTACHMENT_HITS) break;
    if (row.contentHash && usedHashes.has(row.contentHash)) continue;
    if (row.contentHash) usedHashes.add(row.contentHash);

    const chunk = row.contentHash ? chunkByHash.get(row.contentHash) : undefined;
    const coveringHits = coveringEmailQueryOverlap(
      query,
      row.subject,
      row.bodyTextUnique,
      extraNeedles,
    );
    const hitSimilarity = filenameMatchesQuery(row.filename, query)
      ? FILENAME_MATCH_SIMILARITY
      : Number(
          Math.min(
            0.9,
            FILENAME_ALIAS_SIMILARITY + coveringHits * 0.05,
          ).toFixed(4),
        );
    if (chunk) {
      const mapped = mapChunkRowToResult(chunk, query);
      mapped.similarity = hitSimilarity;
      mapped.rawSimilarity = hitSimilarity;
      mapped.metadata = {
        ...mapped.metadata,
        filename: row.filename,
        attachmentId: row.attachmentId,
        filenameMatch: filenameMatchesQuery(row.filename, query),
        filenameAlias: filenameMatchesAlias(row.filename, extraNeedles),
      };
      if (!mapped.sourceLink) {
        mapped.sourceLink = `/api/email/attachments/${row.attachmentId}`;
      }
      if (!mapped.emailLink) {
        mapped.emailLink = emailMessageDetailHref(row.emailId);
      }
      results.push(mapped);
      continue;
    }

    results.push(
      syntheticFilenameResult({
        query,
        attachmentId: row.attachmentId,
        filename: row.filename,
        mimeType: row.mimeType,
        contentHash: row.contentHash,
        emailId: row.emailId,
        subject: row.subject,
        fromAddress: row.fromAddress,
        receivedAt: row.receivedAt,
        threadId: row.threadId,
        similarity: hitSimilarity,
      }),
    );
  }

  return results;
}

const MAX_SIBLING_EMAILS = 8;
const MAX_SIBLING_ATTACHMENTS = 12;
const FILE_SEEKING_ATTACHMENT_BOOST = 0.04;

async function loadSiblingAttachmentResults(
  hits: CorpusSearchResult[],
  query: string,
  sourceKind: NonNullable<CorpusSearchOptions["sourceKind"]>,
): Promise<CorpusSearchResult[]> {
  if (sourceKind === "email_body") return [];

  const parentSim = new Map<string, number>();
  for (const hit of hits) {
    if (hit.sourceKind !== "email_body" || !hit.emailId) continue;
    parentSim.set(
      hit.emailId,
      Math.max(parentSim.get(hit.emailId) ?? 0, hit.similarity),
    );
  }

  const emailIds = [...parentSim.keys()].slice(0, MAX_SIBLING_EMAILS);
  if (emailIds.length === 0) return [];

  const already = new Set(
    hits
      .map((hit) => hit.contentHash)
      .filter((hash): hash is string => Boolean(hash)),
  );

  const db = getDb();
  const attachmentRows = await db
    .select({
      attachmentId: emailAttachments.id,
      filename: emailAttachments.filename,
      mimeType: emailAttachments.mimeType,
      contentHash: emailAttachments.contentHash,
      emailId: emailAttachments.emailId,
      subject: emails.subject,
      fromAddress: emails.fromAddress,
      receivedAt: emails.receivedAt,
      threadId: emails.threadId,
    })
    .from(emailAttachments)
    .innerJoin(emails, eq(emails.id, emailAttachments.emailId))
    .where(inArray(emailAttachments.emailId, emailIds));

  const hashes = [
    ...new Set(
      attachmentRows
        .map((row) => row.contentHash)
        .filter(
          (hash): hash is string => Boolean(hash) && !already.has(hash),
        ),
    ),
  ];

  const chunkByHash = new Map<string, MappedChunkRow>();
  if (hashes.length > 0) {
    const chunkConditions = [
      inArray(documentChunks.contentHash, hashes),
      eq(documentChunks.chunkIndex, 0),
    ];
    if (sourceKind !== "all") {
      chunkConditions.push(eq(documentChunks.sourceKind, sourceKind));
    }

    const chunkRows = await db
      .select({
        id: documentChunks.id,
        sourceKind: documentChunks.sourceKind,
        emailId: documentChunks.emailId,
        contentHash: documentChunks.contentHash,
        pageNo: documentChunks.pageNo,
        chunkIndex: documentChunks.chunkIndex,
        chunkText: documentChunks.chunkText,
        metadataJson: documentChunks.metadataJson,
      })
      .from(documentChunks)
      .where(and(...chunkConditions));

    for (const row of chunkRows) {
      if (!row.contentHash || chunkByHash.has(row.contentHash)) continue;
      if (row.sourceKind === "email_body") continue;
      chunkByHash.set(row.contentHash, { ...row, similarity: 0 });
    }
  }

  const results: CorpusSearchResult[] = [];
  const usedHashes = new Set<string>();

  for (const row of attachmentRows) {
    if (results.length >= MAX_SIBLING_ATTACHMENTS) break;
    if (row.contentHash && (already.has(row.contentHash) || usedHashes.has(row.contentHash))) {
      continue;
    }
    if (row.contentHash) usedHashes.add(row.contentHash);

    const parent = parentSim.get(row.emailId) ?? 0.7;
    const similarity = Math.max(0.2, Number((parent - 0.02).toFixed(4)));
    const chunk = row.contentHash ? chunkByHash.get(row.contentHash) : undefined;
    if (chunk) {
      const mapped = mapChunkRowToResult({ ...chunk, similarity }, query);
      mapped.similarity = similarity;
      mapped.rawSimilarity = similarity;
      mapped.metadata = {
        ...mapped.metadata,
        filename: row.filename,
        attachmentId: row.attachmentId,
        siblingOfEmail: true,
      };
      if (!mapped.sourceLink) {
        mapped.sourceLink = `/api/email/attachments/${row.attachmentId}`;
      }
      results.push(mapped);
      continue;
    }

    results.push(
      syntheticFilenameResult({
        query,
        attachmentId: row.attachmentId,
        filename: row.filename,
        mimeType: row.mimeType,
        contentHash: row.contentHash,
        emailId: row.emailId,
        subject: row.subject,
        fromAddress: row.fromAddress,
        receivedAt: row.receivedAt,
        threadId: row.threadId,
        similarity,
      }),
    );
  }

  return results;
}

function applyFileSeekingAttachmentBoost(
  hits: CorpusSearchResult[],
  fileSeeking: boolean,
): CorpusSearchResult[] {
  if (!fileSeeking) return hits;
  return hits
    .map((hit) => {
      if (hit.sourceKind === "email_body") return hit;
      const similarity = Math.min(
        0.99,
        Number((hit.similarity + FILE_SEEKING_ATTACHMENT_BOOST).toFixed(4)),
      );
      return { ...hit, similarity };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

async function attachFileCardsToResults(
  results: CorpusSearchResult[],
): Promise<CorpusSearchResult[]> {
  const map = await loadCorpusSearchFileCards(
    results.map((r) => r.contentHash).filter((h): h is string => Boolean(h)),
  );
  if (map.size === 0) return results;
  return results.map((result) => {
    if (!result.contentHash) return result;
    const fileCard = map.get(result.contentHash);
    return fileCard ? { ...result, fileCard } : result;
  });
}

async function enrichOrSlice(
  query: string,
  mapped: CorpusSearchResult[],
  limit: number,
  usage: CorpusSearchUsage,
): Promise<CorpusSearchResponse> {
  try {
    const enriched = await enrichSearchWithRegistry({
      query,
      results: mapped,
      limit: mapped.length,
    });
    const results = await attachFileCardsToResults(
      selectHybridResults(enriched.results, limit),
    );
    return {
      results,
      matchedEntities: enriched.matchedEntities,
      usage,
    };
  } catch (err) {
    console.error("[corpus-search] registry boost failed:", err);
    const results = await attachFileCardsToResults(
      selectHybridResults(mapped, limit),
    );
    return {
      results,
      matchedEntities: [],
      usage,
    };
  }
}

/**
 * Searches the vector corpus by cosine similarity, merged with lexical
 * attachment-filename hits so file-name queries do not depend on PDF text.
 * By default an LLM rewrites the question first; the original query is kept
 * for excerpts and (in ask) for the grounded answer.
 */
export async function searchCorpus(
  options: CorpusSearchOptions,
): Promise<CorpusSearchResponse> {
  const query = options.query.trim();
  if (!query) {
    return {
      results: [],
      matchedEntities: [],
      usage: EMPTY_SEARCH_USAGE,
    };
  }

  const limit = Math.max(1, Math.min(50, options.limit ?? 10));
  const candidateLimit = Math.min(50, Math.max(limit * 3, limit));
  const minSimilarity = options.minSimilarity ?? 0.2;
  const sourceKind = options.sourceKind ?? "all";

  let retrievalQuery = query;
  let extraNeedles: string[] = [];
  let fileSeeking = isFileSeekingQuery(query);
  let rewrite: CorpusQueryRewrite | undefined;
  let rewriteUsage: CorpusRewriteUsage | undefined;

  if (options.rewriteQuery !== false) {
    try {
      const rewritten = await rewriteCorpusQuery(query);
      rewrite = rewritten.rewrite;
      rewriteUsage = rewritten.usage;
      retrievalQuery = rewritten.rewrite.retrievalQuery || query;
      extraNeedles = rewritten.rewrite.lexicalNeedles;
      fileSeeking = fileSeeking || rewritten.rewrite.fileSeeking;
    } catch (err) {
      console.error(
        "[corpus-search] query rewrite failed; using original query:",
        err,
      );
    }
  }

  const filenameHits = await loadFilenameMatchedResults(
    query,
    sourceKind,
    extraNeedles,
  );

  let vectorHits: CorpusSearchResult[] = [];
  let usage: CorpusSearchUsage = EMPTY_SEARCH_USAGE;

  try {
    const embedded = await embedQuery(retrievalQuery);
    const queryVector = embedded.vector;
    usage = summarizeEmbeddingUsage(embedded.usage);
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

    vectorHits = rows.map((row) => mapChunkRowToResult(row, query));
  } catch (err) {
    if (filenameHits.length === 0) throw err;
    console.error(
      "[corpus-search] embedding search failed; returning filename matches:",
      err,
    );
  }

  const mapped = applyFileSeekingAttachmentBoost(
    mergeSearchResults(
      filenameHits,
      fileSeeking
        ? [
            ...vectorHits,
            ...(await loadSiblingAttachmentResults(
              vectorHits,
              query,
              sourceKind,
            )),
          ]
        : vectorHits,
    ),
    fileSeeking,
  );
  const enriched = await enrichOrSlice(query, mapped, limit, usage);
  return {
    ...enriched,
    rewrite,
    rewriteUsage,
  };
}
