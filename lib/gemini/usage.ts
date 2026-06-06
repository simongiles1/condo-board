import type { UsageMetadata } from "@google/generative-ai";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type GeminiUsageCall = TokenUsage & {
  step: string;
  modelName: string;
};

export type AiUsageRunKind =
  | "initial_processing"
  | "omissions_analysis"
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
};

export type AiUsageLog = {
  runs: AiUsageRun[];
};

const DEFAULT_INPUT_PRICE_PER_MILLION = 1.5;
const DEFAULT_OUTPUT_PRICE_PER_MILLION = 9;

const MODEL_PRICING_USD_PER_MILLION: Record<
  string,
  { input: number; output: number }
> = {
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.1-flash-live-preview": { input: 0.75, output: 4.5 },
  "gemini-3.5-flash": { input: 1.5, output: 9 },
};

const MODEL_PRICING_ALIASES: Array<{
  match: RegExp;
  pricing: { input: number; output: number };
}> = [
  {
    match: /gemini-3\.5-flash/i,
    pricing: MODEL_PRICING_USD_PER_MILLION["gemini-3.5-flash"],
  },
  {
    match: /gemini-3\.1-flash-live-preview/i,
    pricing: MODEL_PRICING_USD_PER_MILLION["gemini-3.1-flash-live-preview"],
  },
  {
    match: /gemini-3\.1-flash-lite/i,
    pricing: MODEL_PRICING_USD_PER_MILLION["gemini-3.1-flash-lite"],
  },
  {
    match: /gemini-2\.5-flash/i,
    pricing: MODEL_PRICING_USD_PER_MILLION["gemini-2.5-flash"],
  },
  {
    match: /gemini-2\.0-flash-lite/i,
    pricing: MODEL_PRICING_USD_PER_MILLION["gemini-2.0-flash-lite"],
  },
  {
    match: /gemini-2\.0-flash/i,
    pricing: MODEL_PRICING_USD_PER_MILLION["gemini-2.0-flash"],
  },
  {
    match: /gemini-2\.5-pro/i,
    pricing: MODEL_PRICING_USD_PER_MILLION["gemini-2.5-pro"],
  },
];

export function extractTokenUsage(metadata?: UsageMetadata): TokenUsage {
  return {
    inputTokens: metadata?.promptTokenCount ?? 0,
    outputTokens: metadata?.candidatesTokenCount ?? 0,
    totalTokens: metadata?.totalTokenCount ?? 0,
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
};

function pricingForModel(modelName: string): ModelPricing {
  const normalized = modelName.trim().toLowerCase();
  const direct = MODEL_PRICING_USD_PER_MILLION[normalized];
  if (direct) {
    return {
      inputPerMillion: direct.input,
      outputPerMillion: direct.output,
    };
  }

  for (const alias of MODEL_PRICING_ALIASES) {
    if (alias.match.test(normalized)) {
      return {
        inputPerMillion: alias.pricing.input,
        outputPerMillion: alias.pricing.output,
      };
    }
  }

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

export function getModelPricing(modelName: string): ModelPricing {
  return pricingForModel(modelName);
}

export function estimateCostBreakdown(
  modelName: string,
  usage: Pick<TokenUsage, "inputTokens" | "outputTokens">,
): CostBreakdown {
  const pricing = pricingForModel(modelName);
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
): number {
  return estimateCostBreakdown(modelName, usage).totalCostUsd;
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
      "gemini-2.5-flash"
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

    const runs = (parsed as AiUsageLog).runs.filter(
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
    );

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
