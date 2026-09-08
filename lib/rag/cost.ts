import { isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { documentChunks } from "@/lib/db/schema";
import {
  estimateCostUsd,
  formatCostUsd,
  getModelPricing,
} from "@/lib/gemini/usage";
import { EMBEDDING_MODEL } from "@/lib/rag/embed";
import type { CorpusIndexStatus } from "@/lib/rag/indexer";
import { getCorpusIndexStatus } from "@/lib/rag/indexer";

/** Heuristic when Gemini does not return usage metadata on an embed call. */
export const EMBEDDING_CHARS_PER_TOKEN = 4;

export type EmbeddingUsage = {
  inputTokens: number;
  outputTokens: 0;
  totalTokens: number;
  tokenSource: "api" | "estimate";
};

export type CorpusEmbeddingCostSummary = {
  modelName: string;
  pricePerMillionInput: number;
  indexedChunks: number;
  indexedInputTokens: number;
  indexedCostUsd: number;
  tokenEstimateMethod: "chunk_text";
  extrapolation: {
    remainingEmails: number;
    remainingAttachments: number;
    remainingVisionPages: number;
    estimatedRemainingChunks: number;
    estimatedRemainingInputTokens: number;
    estimatedRemainingCostUsd: number;
    estimatedTotalCostUsd: number;
    formattedRemaining: string;
    formattedTotal: string;
  };
};

export function estimateEmbeddingTokensFromText(text: string): number {
  const chars = text.trim().length;
  if (chars === 0) return 0;
  return Math.max(1, Math.ceil(chars / EMBEDDING_CHARS_PER_TOKEN));
}

export function estimateEmbeddingTokensFromTexts(texts: string[]): number {
  return texts.reduce(
    (sum, text) => sum + estimateEmbeddingTokensFromText(text),
    0,
  );
}

export function buildEmbeddingUsage(
  inputTokens: number,
  tokenSource: EmbeddingUsage["tokenSource"],
): EmbeddingUsage {
  return {
    inputTokens,
    outputTokens: 0,
    totalTokens: inputTokens,
    tokenSource,
  };
}

export function estimateEmbeddingCostUsd(inputTokens: number): number {
  return estimateCostUsd(EMBEDDING_MODEL, {
    inputTokens,
    outputTokens: 0,
  });
}

export function summarizeEmbeddingUsage(
  usage: EmbeddingUsage,
): { inputTokens: number; costUsd: number; tokenSource: EmbeddingUsage["tokenSource"] } {
  return {
    inputTokens: usage.inputTokens,
    costUsd: estimateEmbeddingCostUsd(usage.inputTokens),
    tokenSource: usage.tokenSource,
  };
}

/**
 * Aggregate indexed corpus cost from stored chunk text lengths.
 * Uses the same chars/token heuristic as embed fallbacks.
 */
export async function getCorpusEmbeddingCostSummary(
  status?: CorpusIndexStatus,
): Promise<CorpusEmbeddingCostSummary> {
  const db = getDb();
  const resolvedStatus = status ?? await getCorpusIndexStatus();
  const pricing = getModelPricing(EMBEDDING_MODEL);

  const [indexed] = await db
    .select({
      chunkCount: sql<number>`count(*)::int`,
      charSum: sql<number>`coalesce(sum(length(${documentChunks.chunkText})), 0)::int`,
    })
    .from(documentChunks)
    .where(isNotNull(documentChunks.embedding));

  const indexedChunks = indexed?.chunkCount ?? 0;
  const indexedInputTokens = tokensFromCharSum(indexed?.charSum ?? 0);
  const indexedCostUsd = estimateEmbeddingCostUsd(indexedInputTokens);

  const avgBySource = await db
    .select({
      sourceKind: documentChunks.sourceKind,
      sourceCount: sql<number>`count(distinct case
        when ${documentChunks.sourceKind} = 'email_body' then ${documentChunks.emailId}::text
        when ${documentChunks.sourceKind} = 'attachment_markdown' then ${documentChunks.contentHash}
        when ${documentChunks.sourceKind} = 'attachment_vision_page' then ${documentChunks.contentHash} || ':' || ${documentChunks.pageNo}::text
        else ${documentChunks.id}
      end)::int`,
      chunkCount: sql<number>`count(*)::int`,
      charSum: sql<number>`coalesce(sum(length(${documentChunks.chunkText})), 0)::int`,
    })
    .from(documentChunks)
    .where(isNotNull(documentChunks.embedding))
    .groupBy(documentChunks.sourceKind);

  const avgChunksPerEmail = averageChunksPerSource(
    avgBySource,
    "email_body",
    resolvedStatus.indexedEmails,
  );
  const avgChunksPerAttachment = averageChunksPerSource(
    avgBySource,
    "attachment_markdown",
    resolvedStatus.indexedAttachments,
  );
  const avgChunksPerVisionPage = averageChunksPerSource(
    avgBySource,
    "attachment_vision_page",
    resolvedStatus.indexedVisionPages,
  );
  const avgTokensPerChunk =
    indexedChunks > 0 ? indexedInputTokens / indexedChunks : 250;

  const remainingEmails = Math.max(0, resolvedStatus.totalEmails - resolvedStatus.indexedEmails);
  const remainingAttachments = Math.max(
    0,
    resolvedStatus.totalParsedAttachments - resolvedStatus.indexedAttachments,
  );
  const remainingVisionPages = Math.max(
    0,
    resolvedStatus.totalDoneVisionPages - resolvedStatus.indexedVisionPages,
  );

  const estimatedRemainingChunks = Math.round(
    remainingEmails * avgChunksPerEmail +
      remainingAttachments * avgChunksPerAttachment +
      remainingVisionPages * avgChunksPerVisionPage,
  );
  const estimatedRemainingInputTokens = Math.round(
    estimatedRemainingChunks * avgTokensPerChunk,
  );
  const estimatedRemainingCostUsd = estimateEmbeddingCostUsd(
    estimatedRemainingInputTokens,
  );
  const estimatedTotalCostUsd = indexedCostUsd + estimatedRemainingCostUsd;

  return {
    modelName: EMBEDDING_MODEL,
    pricePerMillionInput: pricing.inputPerMillion,
    indexedChunks,
    indexedInputTokens,
    indexedCostUsd,
    tokenEstimateMethod: "chunk_text",
    extrapolation: {
      remainingEmails,
      remainingAttachments,
      remainingVisionPages,
      estimatedRemainingChunks,
      estimatedRemainingInputTokens,
      estimatedRemainingCostUsd,
      estimatedTotalCostUsd,
      formattedRemaining: formatCostUsd(estimatedRemainingCostUsd),
      formattedTotal: formatCostUsd(estimatedTotalCostUsd),
    },
  };
}

function tokensFromCharSum(charSum: number): number {
  if (charSum <= 0) return 0;
  return Math.max(1, Math.ceil(charSum / EMBEDDING_CHARS_PER_TOKEN));
}

function averageChunksPerSource(
  rows: Array<{
    sourceKind: string;
    sourceCount: number;
    chunkCount: number;
  }>,
  sourceKind: string,
  indexedSources: number,
): number {
  const row = rows.find((entry) => entry.sourceKind === sourceKind);
  if (!row || indexedSources <= 0) {
    if (sourceKind === "email_body") return 3;
    if (sourceKind === "attachment_markdown") return 8;
    return 2;
  }
  return row.chunkCount / indexedSources;
}
