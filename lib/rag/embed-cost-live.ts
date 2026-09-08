import {
  estimateEmbeddingCostUsd,
  type EmbeddingUsage,
} from "@/lib/rag/cost";

/** Rolling window for live embed burn-rate (matches corpus ETA polling). */
export const EMBED_COST_ROLLING_WINDOW_MS = 60_000;

export type EmbedCostSample = {
  atMs: number;
  inputTokens: number;
  charCount: number;
  costUsd: number;
  tokenSource: EmbeddingUsage["tokenSource"];
};

export type EmbedCostRollingSnapshot = {
  windowMs: number;
  sampleCount: number;
  apiSampleCount: number;
  inputTokens: number;
  charCount: number;
  costUsd: number;
  /** Billed input tokens per minute over the rolling window. */
  tokensPerMinute: number;
  /** Billed USD per minute over the rolling window. */
  costPerMinute: number;
  /** Average characters per billed token (API samples only). */
  charsPerToken: number | null;
  tokenSource: "api" | "estimate" | "mixed" | "none";
};

const samples: EmbedCostSample[] = [];

function pruneSamples(nowMs: number): void {
  const cutoff = nowMs - EMBED_COST_ROLLING_WINDOW_MS;
  let write = 0;
  for (const sample of samples) {
    if (sample.atMs >= cutoff) {
      samples[write++] = sample;
    }
  }
  samples.length = write;
}

/** Record one Gemini embed API call (single or batch). */
export function recordEmbedApiUsage(
  texts: string[],
  usage: EmbeddingUsage,
  atMs = Date.now(),
): void {
  if (usage.inputTokens <= 0) return;

  const charCount = texts.reduce(
    (sum, text) => sum + (text?.trim().length ?? 0),
    0,
  );
  samples.push({
    atMs,
    inputTokens: usage.inputTokens,
    charCount,
    costUsd: estimateEmbeddingCostUsd(usage.inputTokens),
    tokenSource: usage.tokenSource,
  });
  pruneSamples(atMs);
}

/** In-memory rolling stats for live UI (not persisted). */
export function getEmbedCostRollingSnapshot(
  nowMs = Date.now(),
): EmbedCostRollingSnapshot {
  pruneSamples(nowMs);

  if (samples.length === 0) {
    return {
      windowMs: EMBED_COST_ROLLING_WINDOW_MS,
      sampleCount: 0,
      apiSampleCount: 0,
      inputTokens: 0,
      charCount: 0,
      costUsd: 0,
      tokensPerMinute: 0,
      costPerMinute: 0,
      charsPerToken: null,
      tokenSource: "none",
    };
  }

  const windowMs = Math.min(
    EMBED_COST_ROLLING_WINDOW_MS,
    Math.max(1, nowMs - samples[0]!.atMs),
  );

  let inputTokens = 0;
  let charCount = 0;
  let costUsd = 0;
  let apiSampleCount = 0;
  let apiChars = 0;
  let apiTokens = 0;
  let hasApi = false;
  let hasEstimate = false;

  for (const sample of samples) {
    inputTokens += sample.inputTokens;
    charCount += sample.charCount;
    costUsd += sample.costUsd;
    if (sample.tokenSource === "api") {
      apiSampleCount += 1;
      apiChars += sample.charCount;
      apiTokens += sample.inputTokens;
      hasApi = true;
    } else {
      hasEstimate = true;
    }
  }

  const minutes = windowMs / 60_000;
  const tokenSource =
    hasApi && hasEstimate
      ? "mixed"
      : hasApi
        ? "api"
        : hasEstimate
          ? "estimate"
          : "none";

  return {
    windowMs: EMBED_COST_ROLLING_WINDOW_MS,
    sampleCount: samples.length,
    apiSampleCount,
    inputTokens,
    charCount,
    costUsd,
    tokensPerMinute: minutes > 0 ? inputTokens / minutes : 0,
    costPerMinute: minutes > 0 ? costUsd / minutes : 0,
    charsPerToken:
      apiTokens > 0 ? apiChars / apiTokens : null,
    tokenSource,
  };
}

/** Test-only reset. */
export function resetEmbedCostLiveSamples(): void {
  samples.length = 0;
}
