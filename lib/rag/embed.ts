import {
  GoogleGenerativeAI,
  type UsageMetadata,
} from "@google/generative-ai";

import {
  buildEmbeddingUsage,
  estimateEmbeddingTokensFromText,
  estimateEmbeddingTokensFromTexts,
  type EmbeddingUsage,
} from "@/lib/rag/cost";
import {
  corpusEmbedConcurrencyFromEnv,
  createSemaphore,
} from "@/lib/rag/concurrency";
import { recordEmbedApiUsage } from "@/lib/rag/embed-cost-live";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSION = 768;
export const EMBEDDING_BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const MAX_CHUNK_CHARS = 8000;

export type EmbedQueryResult = {
  vector: number[];
  usage: EmbeddingUsage;
};

export type EmbedTextsResult = {
  vectors: number[][];
  usage: EmbeddingUsage;
};

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim()) {
    throw new Error(
      "GEMINI_API_KEY is missing. Copy .env.local.example to .env.local.",
    );
  }
  return key;
}

let cachedAi: GoogleGenerativeAI | null = null;

function getAiClient(): GoogleGenerativeAI {
  if (!cachedAi) {
    cachedAi = new GoogleGenerativeAI(requireApiKey());
  }
  return cachedAi;
}

function getEmbeddingModel() {
  return getAiClient().getGenerativeModel({ model: EMBEDDING_MODEL });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

function usageFromMetadata(
  metadata: UsageMetadata | undefined,
  fallbackTexts: string[],
): EmbeddingUsage {
  const inputTokens = metadata?.promptTokenCount ?? 0;
  if (inputTokens > 0) {
    return buildEmbeddingUsage(inputTokens, "api");
  }
  return buildEmbeddingUsage(
    estimateEmbeddingTokensFromTexts(fallbackTexts),
    "estimate",
  );
}

/**
 * Generate embedding vector for a search query.
 */
export async function embedQuery(query: string): Promise<EmbedQueryResult> {
  const trimmed = query.trim().slice(0, MAX_CHUNK_CHARS);
  if (!trimmed) {
    return {
      vector: new Array(EMBEDDING_DIMENSION).fill(0),
      usage: buildEmbeddingUsage(0, "estimate"),
    };
  }

  const model = getEmbeddingModel();
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const res = await model.embedContent({
        content: { role: "user", parts: [{ text: trimmed }] },
        outputDimensionality: EMBEDDING_DIMENSION,
      });
      const usage = usageFromMetadata(res.usageMetadata, [trimmed]);
      recordEmbedApiUsage([trimmed], usage);
      return {
        vector: res.embedding.values,
        usage,
      };
    } catch (err) {
      attempt++;
      if (attempt >= MAX_RETRIES || !isRetryableError(err)) {
        throw err;
      }
      await delay(Math.pow(2, attempt) * 1000);
    }
  }

  throw new Error(`Failed to embed query after ${MAX_RETRIES} attempts`);
}

/**
 * Generate embeddings for a list of texts in batches.
 * Preserves the exact array order and length.
 * Runs up to CORPUS_EMBED_CONCURRENCY batch API calls in parallel (default 2).
 */
export async function embedTexts(texts: string[]): Promise<EmbedTextsResult> {
  if (texts.length === 0) {
    return {
      vectors: [],
      usage: buildEmbeddingUsage(0, "estimate"),
    };
  }

  const model = getEmbeddingModel();
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    batches.push(texts.slice(i, i + EMBEDDING_BATCH_SIZE));
  }

  const embedSlot = createSemaphore(corpusEmbedConcurrencyFromEnv());
  const batchResults = await Promise.all(
    batches.map((batch, batchIndex) =>
      embedSlot.run(() => embedTextBatch(model, batch, batchIndex * EMBEDDING_BATCH_SIZE)),
    ),
  );

  const results: number[][] = [];
  let inputTokens = 0;
  let tokenSource: EmbeddingUsage["tokenSource"] = "api";
  for (const batchResult of batchResults) {
    results.push(...batchResult.vectors);
    inputTokens += batchResult.usage.inputTokens;
    if (batchResult.usage.tokenSource === "estimate") {
      tokenSource = "estimate";
    }
  }

  return {
    vectors: results,
    usage: buildEmbeddingUsage(inputTokens, tokenSource),
  };
}

async function embedTextBatch(
  model: ReturnType<typeof getEmbeddingModel>,
  batch: string[],
  batchStartIndex: number,
): Promise<{ vectors: number[][]; usage: EmbeddingUsage }> {
  const requests = batch.map((text) => {
    const safeText = (text || " ").trim().slice(0, MAX_CHUNK_CHARS) || " ";
    return {
      content: { role: "user", parts: [{ text: safeText }] },
      outputDimensionality: EMBEDDING_DIMENSION,
    };
  });

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const res = await model.batchEmbedContents({ requests });
      const batchTexts = batch.map((text) => text || " ");
      const usage = usageFromMetadata(res.usageMetadata, batchTexts);
      recordEmbedApiUsage(batchTexts, usage);
      return {
        vectors: res.embeddings.map((emb) => emb.values),
        usage,
      };
    } catch (err) {
      attempt++;
      if (attempt >= MAX_RETRIES || !isRetryableError(err)) {
        throw err;
      }
      await delay(Math.pow(2, attempt) * 1000);
    }
  }

  throw new Error(
    `Failed to embed batch starting at index ${batchStartIndex} after ${MAX_RETRIES} attempts`,
  );
}

/**
 * Pure helper for calculating cosine similarity between two float vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export { estimateEmbeddingTokensFromText };
