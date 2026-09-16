import type { TokenUsage } from "@/lib/gemini/usage";
import {
  estimateSegmentCompareCostUsd,
  segmentCompareCombinationKey,
  segmentCompareModel,
  SAVED_EXTRACT_COMBINATION_KEY,
  type SegmentCompareRun,
  type SegmentCompareSlotChoice,
  type SegmentCompareUsage,
} from "@/lib/meeting-v2/segment-compare-models";

export type SegmentCompareCostBaseline = {
  walk: TokenUsage;
  edge: TokenUsage;
  billedAtMs: number;
  /** Measured from a completed V4×V4 lab run, or scaled from pipeline extract tokens. */
  source: "v4_lab_run" | "extract_plus_ratio";
};

/** DeepSeek thinking runs — modest uplift vs plain JSON. */
const DEEPSEEK_THINKING_OUTPUT_MULTIPLIER = 2;
const DEEPSEEK_THINKING_INPUT_MULTIPLIER = 1.05;
/**
 * Gemini `thinkingLevel: medium` bills many more output (thought) tokens than minimal.
 * Estimates use a conservative uplift so thinking combos are not underpriced vs plain baselines.
 */
const GEMINI_THINKING_OUTPUT_MULTIPLIER = 6;
const GEMINI_THINKING_INPUT_MULTIPLIER = 1.1;
/** When only extract walk tokens exist, edge judges are approximated from walk volume. */
const DEFAULT_EDGE_TO_WALK_INPUT_RATIO = 0.45;

function usageFromSlotUsage(usage: SegmentCompareUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
  };
}

function latestCompletedRunForKey(
  runs: SegmentCompareRun[],
  key: string,
): SegmentCompareRun | null {
  const matches = runs.filter(
    (run) =>
      run.status === "completed" &&
      segmentCompareCombinationKey(run.walk, run.edge) === key,
  );
  return matches[matches.length - 1] ?? null;
}

function latestRunForKey(runs: SegmentCompareRun[], key: string): SegmentCompareRun | null {
  const matches = runs.filter(
    (run) => segmentCompareCombinationKey(run.walk, run.edge) === key,
  );
  return matches[matches.length - 1] ?? null;
}

function scaleTokenUsage(base: TokenUsage, inputRatio: number): TokenUsage {
  const ratio = Math.max(0, inputRatio);
  return {
    inputTokens: Math.round(base.inputTokens * ratio),
    outputTokens: Math.round(base.outputTokens * ratio),
    totalTokens: Math.round((base.inputTokens + base.outputTokens) * ratio),
    cacheHitTokens: base.cacheHitTokens
      ? Math.round(base.cacheHitTokens * ratio)
      : undefined,
    cacheMissTokens: base.cacheMissTokens
      ? Math.round(base.cacheMissTokens * ratio)
      : undefined,
  };
}

function thinkingTokenMultipliers(
  modelId: import("@/lib/meeting-v2/segment-compare-models").SegmentCompareModelId,
): { input: number; output: number } {
  const provider = segmentCompareModel(modelId).provider;
  if (provider === "gemini") {
    return {
      input: GEMINI_THINKING_INPUT_MULTIPLIER,
      output: GEMINI_THINKING_OUTPUT_MULTIPLIER,
    };
  }
  return {
    input: DEEPSEEK_THINKING_INPUT_MULTIPLIER,
    output: DEEPSEEK_THINKING_OUTPUT_MULTIPLIER,
  };
}

function applyThinkingProfile(
  usage: TokenUsage,
  thinking: boolean,
  modelId: import("@/lib/meeting-v2/segment-compare-models").SegmentCompareModelId,
): TokenUsage {
  if (!thinking) return usage;
  const { input, output } = thinkingTokenMultipliers(modelId);
  const inputTokens = Math.round(usage.inputTokens * input);
  const outputTokens = Math.round(usage.outputTokens * output);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheHitTokens: usage.cacheHitTokens
      ? Math.round(usage.cacheHitTokens * input)
      : undefined,
    cacheMissTokens: usage.cacheMissTokens
      ? Math.round(usage.cacheMissTokens * input)
      : undefined,
  };
}

export function buildSegmentCompareCostBaseline(
  runs: SegmentCompareRun[],
  extractWalkUsage: TokenUsage | null,
): SegmentCompareCostBaseline | null {
  const v4Run = latestCompletedRunForKey(runs, SAVED_EXTRACT_COMBINATION_KEY);
  if (v4Run?.walkUsage && v4Run.edgeUsage) {
    return {
      walk: usageFromSlotUsage(v4Run.walkUsage),
      edge: usageFromSlotUsage(v4Run.edgeUsage),
      billedAtMs: v4Run.completedAt ? Date.parse(v4Run.completedAt) : Date.now(),
      source: "v4_lab_run",
    };
  }

  const completedWithUsage = runs.filter(
    (run) => run.status === "completed" && run.walkUsage && run.edgeUsage,
  );
  const ratioRun = completedWithUsage[completedWithUsage.length - 1];

  if (extractWalkUsage && ratioRun?.walkUsage && ratioRun.edgeUsage) {
    const ratio =
      ratioRun.edgeUsage.inputTokens / Math.max(1, ratioRun.walkUsage.inputTokens);
    return {
      walk: extractWalkUsage,
      edge: scaleTokenUsage(extractWalkUsage, ratio),
      billedAtMs: Date.now(),
      source: "extract_plus_ratio",
    };
  }

  if (extractWalkUsage) {
    return {
      walk: extractWalkUsage,
      edge: scaleTokenUsage(extractWalkUsage, DEFAULT_EDGE_TO_WALK_INPUT_RATIO),
      billedAtMs: Date.now(),
      source: "extract_plus_ratio",
    };
  }

  return null;
}

export function estimateSegmentCompareCombinationCostUsd(
  walk: SegmentCompareSlotChoice,
  edge: SegmentCompareSlotChoice,
  baseline: SegmentCompareCostBaseline,
): number {
  const walkUsage = applyThinkingProfile(baseline.walk, walk.thinking, walk.modelId);
  const edgeUsage = applyThinkingProfile(baseline.edge, edge.thinking, edge.modelId);
  const walkModel = segmentCompareModel(walk.modelId);
  const edgeModel = segmentCompareModel(edge.modelId);
  const billedAt = baseline.billedAtMs;
  const walkCost = estimateSegmentCompareCostUsd(walkModel.apiModel, walkUsage, billedAt);
  const edgeCost = estimateSegmentCompareCostUsd(edgeModel.apiModel, edgeUsage, billedAt);
  return walkCost + edgeCost;
}

export function cellCostLabel(
  walk: SegmentCompareSlotChoice,
  edge: SegmentCompareSlotChoice,
  runs: SegmentCompareRun[],
  baseline: SegmentCompareCostBaseline | null,
): { text: string; isEstimate: boolean } {
  const key = segmentCompareCombinationKey(walk, edge);
  const latest = latestRunForKey(runs, key);
  if (latest?.totalCostUsd != null && Number.isFinite(latest.totalCostUsd)) {
    if (latest.status === "failed") {
      return {
        text: `${formatCostUsd(latest.totalCostUsd)} spent`,
        isEstimate: false,
      };
    }
    if (latest.status === "completed") {
      return { text: formatCostUsd(latest.totalCostUsd), isEstimate: false };
    }
  }
  if (!baseline) {
    return { text: "—", isEstimate: false };
  }
  const estimate = estimateSegmentCompareCombinationCostUsd(walk, edge, baseline);
  return { text: `~${formatCostUsd(estimate)}`, isEstimate: true };
}

export function formatSegmentCompareCostUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatCostUsd(value: number): string {
  return formatSegmentCompareCostUsd(value);
}

export function parseSegmentCompareProgressStep(
  progressLabel: string | null | undefined,
): { step: number; total: number } | null {
  if (!progressLabel) return null;
  const match = progressLabel.match(/^(?:Walk|Edge) (\d+)\/(\d+)$/);
  if (!match) return null;
  const step = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(step) || !Number.isFinite(total) || step <= 0 || total <= 0) {
    return null;
  }
  return { step, total };
}

/** Linear extrapolation from spend so far and Walk/Edge step counters. */
export function extrapolateSegmentCompareRunTotalCostUsd(
  spentUsd: number,
  progressLabel: string | null | undefined,
): number | null {
  if (!Number.isFinite(spentUsd) || spentUsd <= 0) return null;
  const progress = parseSegmentCompareProgressStep(progressLabel);
  if (!progress) return null;
  return spentUsd * (progress.total / progress.step);
}

export function cellRunningCostDisplay(
  run: SegmentCompareRun,
  walk: SegmentCompareSlotChoice,
  edge: SegmentCompareSlotChoice,
  baseline: SegmentCompareCostBaseline | null,
): { spentText: string | null; estimatedText: string | null } {
  if (run.status !== "queued" && run.status !== "running") {
    return { spentText: null, estimatedText: null };
  }

  const spentUsd = run.totalCostUsd;
  const spentText =
    spentUsd != null && Number.isFinite(spentUsd) && spentUsd > 0
      ? formatCostUsd(spentUsd)
      : null;

  let estimatedUsd = extrapolateSegmentCompareRunTotalCostUsd(spentUsd ?? 0, run.progressLabel);
  if (estimatedUsd == null && baseline) {
    estimatedUsd = estimateSegmentCompareCombinationCostUsd(walk, edge, baseline);
  }
  const estimatedText =
    estimatedUsd != null && Number.isFinite(estimatedUsd)
      ? `Est. ${formatCostUsd(estimatedUsd)}`
      : null;

  return { spentText, estimatedText };
}
