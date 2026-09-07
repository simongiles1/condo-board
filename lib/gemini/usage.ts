import type { UsageMetadata } from "@google/generative-ai";

import {
  estimateDeepSeekCostBreakdown,
  estimateDeepSeekOffPeakOptimizedBreakdown,
  isDeepSeekModelName,
  resolveInputCacheSplit,
  type DeepSeekPricingTier,
} from "@/lib/deepseek/pricing";
import {
  billedPricingForModel,
  type ModelTokenPricing,
} from "@/lib/gemini/pricing";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
};

export type GeminiUsageCall = TokenUsage & {
  step: string;
  modelName: string;
};

export type AiUsageRunKind =
  | "initial_processing"
  | "omissions_analysis"
  | "gold_standard_validation"
  | "email_analysis";

export type AiUsageRun = {
  id: string;
  kind: AiUsageRunKind;
  label: string;
  ranAt: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  /** Per-step token usage when available (e.g. initial minutes vs to-dos). */
  calls?: GeminiUsageCall[];
};

/** One row in the AI cost breakdown table (a pipeline stage or processing step). */
export type AiUsageStageRow = {
  id: string;
  label: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** When true, this stage has no recorded LLM token usage (row shows N/A). */
  notApplicable?: boolean;
  /** Pipeline vs manual review step — mirrors the seven-step workflow. */
  stageKind?: "pipeline" | "user";
  /** Non-token detail (e.g. Docling page count). */
  usageDetail?: string;
  /** DeepSeek prompt-cache hit tokens when recorded per API call. */
  cacheHitTokens?: number;
  /** DeepSeek prompt-cache miss tokens when recorded per API call. */
  cacheMissTokens?: number;
  /** UTC instant used for peak/off-peak DeepSeek pricing when a single tier applies. */
  billedAtMs?: number;
  /** Server-precomputed costs (per-call peak/off-peak + cache mix). */
  inputCostUsd?: number;
  outputCostUsd?: number;
  totalCostUsd?: number;
  /** When set, this stage spans multiple peak/off-peak windows. */
  pricingTier?: DeepSeekPricingTier | "mixed";
};

export type AiUsageLog = {
  runs: AiUsageRun[];
};

const DEFAULT_INPUT_PRICE_PER_MILLION = 1.5;
const DEFAULT_OUTPUT_PRICE_PER_MILLION = 9;

type UsageMetadataLike = Pick<
  UsageMetadata,
  "promptTokenCount" | "candidatesTokenCount" | "totalTokenCount"
> & {
  thoughtsTokenCount?: number;
};

/**
 * Billed output includes thinking tokens. Prefer max(total - prompt,
 * candidates + thoughts) so we do not undercount when the SDK omits
 * `thoughtsTokenCount` but still folds thoughts into `totalTokenCount`.
 */
export function extractTokenUsage(
  metadata?: UsageMetadata | UsageMetadataLike,
): TokenUsage {
  const inputTokens = metadata?.promptTokenCount ?? 0;
  const candidates = metadata?.candidatesTokenCount ?? 0;
  const thoughts = Number(
    metadata && "thoughtsTokenCount" in metadata
      ? metadata.thoughtsTokenCount
      : 0,
  ) || 0;
  const totalTokens = metadata?.totalTokenCount ?? 0;
  const outputTokens = Math.max(
    Math.max(0, totalTokens - inputTokens),
    candidates + thoughts,
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
  };
}

export function sumTokenUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      totalTokens: acc.totalTokens + usage.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}

export function sumUsageCalls(calls: GeminiUsageCall[]): TokenUsage {
  return sumTokenUsage(calls);
}

export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

export type CostBreakdown = {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  pricing: ModelPricing;
  deepSeekTier?: DeepSeekPricingTier | "mixed";
};

function toModelPricing(pricing: ModelTokenPricing): ModelPricing {
  return {
    inputPerMillion: pricing.input,
    outputPerMillion: pricing.output,
  };
}

function pricingForModel(modelName: string, nowMs = Date.now()): ModelPricing {
  const billed = billedPricingForModel(modelName, nowMs);
  if (billed) return toModelPricing(billed);

  const inputOverride = Number(process.env.GEMINI_PRICE_INPUT_PER_MILLION);
  const outputOverride = Number(process.env.GEMINI_PRICE_OUTPUT_PER_MILLION);

  return {
    inputPerMillion: Number.isFinite(inputOverride)
      ? inputOverride
      : DEFAULT_INPUT_PRICE_PER_MILLION,
    outputPerMillion: Number.isFinite(outputOverride)
      ? outputOverride
      : DEFAULT_OUTPUT_PRICE_PER_MILLION,
  };
}

export function getModelPricing(modelName: string, nowMs?: number): ModelPricing {
  return pricingForModel(modelName, nowMs);
}

export type BillableUsageInput = Pick<
  TokenUsage,
  "inputTokens" | "outputTokens"
> & {
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  billedAtMs?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  totalCostUsd?: number;
  pricingTier?: DeepSeekPricingTier | "mixed";
};

export function estimateCostBreakdown(
  modelName: string,
  usage: BillableUsageInput,
  nowMs?: number,
): CostBreakdown {
  if (
    typeof usage.totalCostUsd === "number" &&
    typeof usage.inputCostUsd === "number" &&
    typeof usage.outputCostUsd === "number"
  ) {
    const pricing = pricingForModel(modelName, nowMs);
    return {
      inputCostUsd: usage.inputCostUsd,
      outputCostUsd: usage.outputCostUsd,
      totalCostUsd: usage.totalCostUsd,
      pricing,
      deepSeekTier: usage.pricingTier,
    };
  }

  if (isDeepSeekModelName(modelName)) {
    const deepSeek = estimateDeepSeekCostBreakdown(
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheHitTokens: usage.cacheHitTokens,
        cacheMissTokens: usage.cacheMissTokens,
        billedAtMs: usage.billedAtMs,
      },
      usage.billedAtMs ?? nowMs,
    );
    return {
      inputCostUsd: deepSeek.inputCostUsd,
      outputCostUsd: deepSeek.outputCostUsd,
      totalCostUsd: deepSeek.totalCostUsd,
      pricing: {
        inputPerMillion: deepSeek.rates.inputCacheMissPerMillion,
        outputPerMillion: deepSeek.rates.outputPerMillion,
      },
      deepSeekTier: deepSeek.tier,
    };
  }

  const pricing = pricingForModel(modelName, nowMs);
  const inputCostUsd =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCostUsd =
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;

  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    pricing,
  };
}

export function estimateCostUsd(
  modelName: string,
  usage: Pick<TokenUsage, "inputTokens" | "outputTokens">,
  nowMs?: number,
): number {
  return estimateCostBreakdown(modelName, usage, nowMs).totalCostUsd;
}

export function estimateCostUsdForCalls(calls: GeminiUsageCall[]): number {
  return calls.reduce(
    (total, call) =>
      total +
      estimateCostUsd(call.modelName, {
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
      }),
    0,
  );
}

function primaryModelName(calls: GeminiUsageCall[]): string {
  if (!calls.length) {
    return (
      process.env.GEMINI_MODEL_MINUTES?.trim() ||
      process.env.GEMINI_MODEL_TODOS?.trim() ||
      "gemini-3.7-flash"
    );
  }

  const counts = new Map<string, number>();
  for (const call of calls) {
    counts.set(call.modelName, (counts.get(call.modelName) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function parseStoredAiUsage(
  raw: string | null | undefined,
): AiUsageLog | null {
  if (!raw?.trim()) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as AiUsageLog).runs)
    ) {
      return null;
    }

    const runs = (parsed as AiUsageLog).runs
      .filter(
        (run): run is AiUsageRun =>
          typeof run === "object" &&
          run !== null &&
          typeof run.id === "string" &&
          typeof run.kind === "string" &&
          typeof run.label === "string" &&
          typeof run.ranAt === "string" &&
          typeof run.modelName === "string" &&
          typeof run.inputTokens === "number" &&
          typeof run.outputTokens === "number" &&
          typeof run.totalTokens === "number" &&
          typeof run.costUsd === "number",
      )
      .map((run) => ({
        ...run,
        calls: parseStoredUsageCalls(run.calls),
      }));

    return { runs };
  } catch {
    return null;
  }
}

export function countOmissionsAnalysisRuns(
  log: AiUsageLog | null | undefined,
): number {
  return (
    log?.runs.filter((run) => run.kind === "omissions_analysis").length ?? 0
  );
}

export function serializeAiUsage(log: AiUsageLog): string {
  return JSON.stringify(log);
}

export function appendAiUsageRun(
  existingJson: string | null | undefined,
  run: AiUsageRun,
): string {
  const existing = parseStoredAiUsage(existingJson);
  const runs = [...(existing?.runs ?? []), run];
  return serializeAiUsage({ runs });
}

function parseStoredUsageCalls(value: unknown): GeminiUsageCall[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const calls = value.filter(
    (call): call is GeminiUsageCall =>
      typeof call === "object" &&
      call !== null &&
      typeof (call as GeminiUsageCall).step === "string" &&
      typeof (call as GeminiUsageCall).modelName === "string" &&
      typeof (call as GeminiUsageCall).inputTokens === "number" &&
      typeof (call as GeminiUsageCall).outputTokens === "number" &&
      typeof (call as GeminiUsageCall).totalTokens === "number",
  );

  return calls.length > 0 ? calls : undefined;
}

export function formatUsageStepLabel(step: string): string {
  const known: Record<string, string> = {
    minutes: "Minutes generation",
    minutes_continuation: "Minutes continuation",
    todos: "To-do extraction",
    generation: "Generation",
    global_todos_merge: "Global to-dos merge",
    email_extraction: "Email extraction",
    page_vision: "Page vision",
    email_extraction_merge: "Email extraction merge",
  };

  if (known[step]) return known[step];

  const retryMatch = /^minutes_retry_(\d+)_/.exec(step);
  if (retryMatch) {
    const attempt = Number(retryMatch[1]) + 1;
    const suffix = step.replace(/^minutes_retry_\d+_/, "");
    const base = known[suffix] ?? suffix.replaceAll("_", " ");
    return `Minutes retry ${attempt} (${base})`;
  }

  return step
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function groupUsageCallsToStages(
  calls: GeminiUsageCall[],
): AiUsageStageRow[] {
  const groups = new Map<
    string,
    {
      label: string;
      modelName: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }
  >();

  for (const call of calls) {
    const key = `${call.step}::${call.modelName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.inputTokens += call.inputTokens;
      existing.outputTokens += call.outputTokens;
      existing.totalTokens += call.totalTokens;
      continue;
    }

    groups.set(key, {
      label: formatUsageStepLabel(call.step),
      modelName: call.modelName,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      totalTokens: call.totalTokens,
    });
  }

  return [...groups.entries()].map(([key, group]) => ({
    id: key,
    ...group,
  }));
}

export function flattenAiUsageToStages(
  log: AiUsageLog | null | undefined,
): AiUsageStageRow[] {
  if (!log?.runs.length) return [];

  const stages: AiUsageStageRow[] = [];

  for (const run of log.runs) {
    if (run.calls?.length) {
      stages.push(...groupUsageCallsToStages(run.calls));
      continue;
    }

    stages.push({
      id: run.id,
      label: run.label,
      modelName: run.modelName,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      totalTokens: run.totalTokens,
    });
  }

  return stages;
}

export type DeepSeekOffPeakOptimizationSummary = {
  cacheHitTokens: number;
  cacheMissTokens: number;
  deepSeekOutputTokens: number;
  offPeakInputCacheHitCostUsd: number;
  offPeakInputCacheMissCostUsd: number;
  offPeakOutputCostUsd: number;
  offPeakTotalCostUsd: number;
};

export function summarizeDeepSeekOffPeakOptimization(
  stages: AiUsageStageRow[],
): DeepSeekOffPeakOptimizationSummary | null {
  const billableStages = stages.filter(
    (stage) => !stage.notApplicable && isDeepSeekModelName(stage.modelName),
  );
  if (billableStages.length === 0) return null;

  let cacheHitTokens = 0;
  let cacheMissTokens = 0;
  let deepSeekOutputTokens = 0;

  for (const stage of billableStages) {
    const split = resolveInputCacheSplit({
      inputTokens: stage.inputTokens,
      outputTokens: 0,
      cacheHitTokens: stage.cacheHitTokens,
      cacheMissTokens: stage.cacheMissTokens,
    });
    cacheHitTokens += split.cacheHitTokens;
    cacheMissTokens += split.cacheMissTokens;
    deepSeekOutputTokens += stage.outputTokens;
  }

  const offPeak = estimateDeepSeekOffPeakOptimizedBreakdown({
    cacheHitTokens,
    cacheMissTokens,
    outputTokens: deepSeekOutputTokens,
  });

  return {
    cacheHitTokens,
    cacheMissTokens,
    deepSeekOutputTokens,
    offPeakInputCacheHitCostUsd: offPeak.inputCacheHitCostUsd,
    offPeakInputCacheMissCostUsd: offPeak.inputCacheMissCostUsd,
    offPeakOutputCostUsd: offPeak.outputCostUsd,
    offPeakTotalCostUsd: offPeak.totalCostUsd,
  };
}

export function sumAiUsageStages(stages: AiUsageStageRow[]): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  costUsd: number;
} {
  const billableStages = stages.filter((stage) => !stage.notApplicable);
  return billableStages.reduce(
    (acc, stage) => {
      const breakdown = estimateCostBreakdown(stage.modelName, stage);
      return {
        inputTokens: acc.inputTokens + stage.inputTokens,
        outputTokens: acc.outputTokens + stage.outputTokens,
        totalTokens: acc.totalTokens + stage.totalTokens,
        inputCostUsd: acc.inputCostUsd + breakdown.inputCostUsd,
        outputCostUsd: acc.outputCostUsd + breakdown.outputCostUsd,
        costUsd: acc.costUsd + breakdown.totalCostUsd,
      };
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputCostUsd: 0,
      outputCostUsd: 0,
      costUsd: 0,
    },
  );
}

export function buildInitialProcessingRun(options: {
  id: string;
  ranAt: string;
  calls: GeminiUsageCall[];
}): AiUsageRun {
  const usage = sumUsageCalls(options.calls);
  const modelName = primaryModelName(options.calls);

  return {
    id: options.id,
    kind: "initial_processing",
    label: "Initial processing",
    ranAt: options.ranAt,
    modelName,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: estimateCostUsdForCalls(options.calls),
    calls: options.calls,
  };
}

export function buildOmissionsAnalysisRun(options: {
  id: string;
  ranAt: string;
  modelName: string;
  usage: TokenUsage;
  existingJson: string | null | undefined;
}): AiUsageRun {
  const existing = parseStoredAiUsage(options.existingJson);
  const priorOmissionsRuns =
    existing?.runs.filter((run) => run.kind === "omissions_analysis").length ??
    0;
  const runNumber = priorOmissionsRuns + 1;

  return {
    id: options.id,
    kind: "omissions_analysis",
    label:
      runNumber === 1
        ? "Omissions analysis"
        : `Omissions analysis #${runNumber}`,
    ranAt: options.ranAt,
    modelName: options.modelName,
    inputTokens: options.usage.inputTokens,
    outputTokens: options.usage.outputTokens,
    totalTokens: options.usage.totalTokens,
    costUsd: estimateCostUsd(options.modelName, options.usage),
  };
}

export function buildGoldStandardValidationRun(options: {
  id: string;
  ranAt: string;
  modelName: string;
  usage: TokenUsage;
  existingJson: string | null | undefined;
}): AiUsageRun {
  const existing = parseStoredAiUsage(options.existingJson);
  const priorRuns =
    existing?.runs.filter((run) => run.kind === "gold_standard_validation")
      .length ?? 0;
  const runNumber = priorRuns + 1;

  return {
    id: options.id,
    kind: "gold_standard_validation",
    label:
      runNumber === 1
        ? "Gold standard validation"
        : `Gold standard validation #${runNumber}`,
    ranAt: options.ranAt,
    modelName: options.modelName,
    inputTokens: options.usage.inputTokens,
    outputTokens: options.usage.outputTokens,
    totalTokens: options.usage.totalTokens,
    costUsd: estimateCostUsd(options.modelName, options.usage),
  };
}

export function getLatestGoldStandardValidationRun(
  log: AiUsageLog | null | undefined,
): AiUsageRun | null {
  if (!log?.runs.length) return null;
  const runs = log.runs.filter((run) => run.kind === "gold_standard_validation");
  if (!runs.length) return null;
  return runs[runs.length - 1] ?? null;
}

export function sumAiUsageRuns(runs: AiUsageRun[]): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  costUsd: number;
} {
  return runs.reduce(
    (acc, run) => {
      const breakdown = estimateCostBreakdown(run.modelName, run);
      return {
        inputTokens: acc.inputTokens + run.inputTokens,
        outputTokens: acc.outputTokens + run.outputTokens,
        totalTokens: acc.totalTokens + run.totalTokens,
        inputCostUsd: acc.inputCostUsd + breakdown.inputCostUsd,
        outputCostUsd: acc.outputCostUsd + breakdown.outputCostUsd,
        costUsd: acc.costUsd + breakdown.totalCostUsd,
      };
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputCostUsd: 0,
      outputCostUsd: 0,
      costUsd: 0,
    },
  );
}

export function formatPricePerMillion(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatTokenCount(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function formatOutputTokensPerSecond(
  outputTokens: number | null | undefined,
  processingDurationMs: number | null | undefined,
): string {
  if (
    outputTokens == null ||
    processingDurationMs == null ||
    processingDurationMs <= 0
  ) {
    return "—";
  }

  const tokensPerSecond = outputTokens / (processingDurationMs / 1000);
  if (tokensPerSecond >= 100) {
    return `${Math.round(tokensPerSecond)}/s`;
  }
  return `${tokensPerSecond.toFixed(1)}/s`;
}

export function formatCostUsd(value: number): string {
  if (value > 0 && value < 0.001) return "< $0.001";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
