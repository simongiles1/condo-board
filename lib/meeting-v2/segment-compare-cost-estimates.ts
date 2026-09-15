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

const THINKING_OUTPUT_MULTIPLIER = 1.35;
const THINKING_INPUT_MULTIPLIER = 1.05;
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

function applyThinkingProfile(usage: TokenUsage, thinking: boolean): TokenUsage {
  if (!thinking) return usage;
  const inputTokens = Math.round(usage.inputTokens * THINKING_INPUT_MULTIPLIER);
  const outputTokens = Math.round(usage.outputTokens * THINKING_OUTPUT_MULTIPLIER);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheHitTokens: usage.cacheHitTokens
      ? Math.round(usage.cacheHitTokens * THINKING_INPUT_MULTIPLIER)
      : undefined,
    cacheMissTokens: usage.cacheMissTokens
      ? Math.round(usage.cacheMissTokens * THINKING_INPUT_MULTIPLIER)
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
  const walkUsage = applyThinkingProfile(baseline.walk, walk.thinking);
  const edgeUsage = applyThinkingProfile(baseline.edge, edge.thinking);
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
  const completed = latestCompletedRunForKey(runs, key);
  if (completed?.totalCostUsd != null && Number.isFinite(completed.totalCostUsd)) {
    return { text: formatCostUsd(completed.totalCostUsd), isEstimate: false };
  }
  if (!baseline) {
    return { text: "—", isEstimate: false };
  }
  const estimate = estimateSegmentCompareCombinationCostUsd(walk, edge, baseline);
  return { text: `~${formatCostUsd(estimate)}`, isEstimate: true };
}

function formatCostUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
