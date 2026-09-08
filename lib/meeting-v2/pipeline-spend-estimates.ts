import { desc, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2 } from "@/lib/db/schema-v2";
import {
  estimateDeepSeekOffPeakOptimizedBreakdown,
  estimateDeepSeekPeakOptimizedBreakdown,
  isDeepSeekModelName,
  resolveInputCacheSplit,
} from "@/lib/deepseek/pricing";
import type { AiUsageStageRow } from "@/lib/gemini/usage";
import { loadMeetingV2AiUsageStages } from "@/lib/meeting-v2/ai-usage";

const PIPELINE_AUTOMATED_STAGE_IDS = new Set([
  "extract",
  "investigate",
  "validate",
]);

const RELIABLE_PIPELINE_STATES = [
  "extracted",
  "gathering_evidence",
  "evidence_gathered",
  "investigating",
  "investigated",
  "validating",
  "validated",
] as const;

const MAX_MEETINGS_TO_SAMPLE = 30;

export type PipelineSpendEstimateSample = {
  meetingId: string;
  actualCostUsd: number;
  offPeakCostUsd: number;
  peakCostUsd: number;
};

export type PipelineSpendEstimates = {
  sampleCount: number;
  averageActualCostUsd: number | null;
  averageOffPeakCostUsd: number | null;
  averagePeakCostUsd: number | null;
};

type PipelineTokenProfile = {
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  actualCostUsd: number;
};

function isReliableMeetingUsage(stages: AiUsageStageRow[]): boolean {
  const extract = stages.find((stage) => stage.id === "extract");
  return Boolean(
    extract &&
      !extract.notApplicable &&
      typeof extract.totalCostUsd === "number" &&
      extract.totalTokens > 0,
  );
}

function sumReliablePipelineProfile(stages: AiUsageStageRow[]): PipelineTokenProfile | null {
  let cacheHitTokens = 0;
  let cacheMissTokens = 0;
  let outputTokens = 0;
  let actualCostUsd = 0;
  let includedStageCount = 0;

  for (const stage of stages) {
    if (!PIPELINE_AUTOMATED_STAGE_IDS.has(stage.id)) continue;
    if (stage.notApplicable || !isDeepSeekModelName(stage.modelName)) continue;
    if (typeof stage.totalCostUsd !== "number") continue;

    const split = resolveInputCacheSplit({
      inputTokens: stage.inputTokens,
      outputTokens: stage.outputTokens,
      cacheHitTokens: stage.cacheHitTokens,
      cacheMissTokens: stage.cacheMissTokens,
    });

    cacheHitTokens += split.cacheHitTokens;
    cacheMissTokens += split.cacheMissTokens;
    outputTokens += stage.outputTokens;
    actualCostUsd += stage.totalCostUsd;
    includedStageCount += 1;
  }

  if (includedStageCount === 0) return null;

  return {
    cacheHitTokens,
    cacheMissTokens,
    outputTokens,
    actualCostUsd,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function loadPipelineSpendEstimates(): Promise<PipelineSpendEstimates> {
  const db = getDb();
  const meetingRows = await db
    .select({ id: meetingsV2.id })
    .from(meetingsV2)
    .where(inArray(meetingsV2.pipelineState, [...RELIABLE_PIPELINE_STATES]))
    .orderBy(desc(meetingsV2.updatedAt))
    .limit(MAX_MEETINGS_TO_SAMPLE);

  const actualCosts: number[] = [];
  const offPeakCosts: number[] = [];
  const peakCosts: number[] = [];

  for (const meeting of meetingRows) {
    const stages = await loadMeetingV2AiUsageStages(meeting.id);
    if (!isReliableMeetingUsage(stages)) continue;

    const profile = sumReliablePipelineProfile(stages);
    if (!profile) continue;

    actualCosts.push(profile.actualCostUsd);
    offPeakCosts.push(
      estimateDeepSeekOffPeakOptimizedBreakdown(profile).totalCostUsd,
    );
    peakCosts.push(
      estimateDeepSeekPeakOptimizedBreakdown(profile).totalCostUsd,
    );
  }

  return {
    sampleCount: actualCosts.length,
    averageActualCostUsd: average(actualCosts),
    averageOffPeakCostUsd: average(offPeakCosts),
    averagePeakCostUsd: average(peakCosts),
  };
}
