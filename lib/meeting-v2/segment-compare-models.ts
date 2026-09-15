import { estimateCostBreakdown } from "@/lib/gemini/usage";
import type { TokenUsage } from "@/lib/gemini/usage";

export const SEGMENT_COMPARE_MODEL_IDS = [
  "deepseek-v4-flash",
  "deepseek-v4.1-flash",
  "gemini-3.8-flash",
] as const;

export type SegmentCompareModelId = (typeof SEGMENT_COMPARE_MODEL_IDS)[number];

export type SegmentCompareProvider = "deepseek" | "gemini";

export type SegmentCompareModelOption = {
  id: SegmentCompareModelId;
  label: string;
  provider: SegmentCompareProvider;
  /** API slug sent to DeepSeek or Gemini. */
  apiModel: string;
  warning?: string;
};

export const SEGMENT_COMPARE_MODELS: SegmentCompareModelOption[] = [
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    apiModel: "deepseek-v4-flash",
    warning:
      "DeepSeek currently aliases this id onto V4.1 Flash. Keep it in the picker so a later un-alias is comparable.",
  },
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    provider: "deepseek",
    apiModel: "deepseek-flash",
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "gemini",
    apiModel: "gemini-3.8-flash",
  },
];

export type SegmentCompareSlot = "walk" | "edge";

export type SegmentCompareSlotChoice = {
  modelId: SegmentCompareModelId;
  thinking: boolean;
};

export function isSegmentCompareModelId(value: string): value is SegmentCompareModelId {
  return (SEGMENT_COMPARE_MODEL_IDS as readonly string[]).includes(value);
}

export function segmentCompareModel(id: SegmentCompareModelId): SegmentCompareModelOption {
  const found = SEGMENT_COMPARE_MODELS.find((model) => model.id === id);
  if (!found) {
    throw new Error(`Unknown segment-compare model: ${id}`);
  }
  return found;
}

export function formatSegmentCompareChoice(choice: SegmentCompareSlotChoice): string {
  const model = segmentCompareModel(choice.modelId);
  return `${model.label}${choice.thinking ? " · thinking" : ""}`;
}

export type SegmentCompareRunStatus = "queued" | "running" | "completed" | "failed";

export type SegmentCompareUsage = {
  modelId: SegmentCompareModelId;
  apiModel: string;
  thinking: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  costUsd: number;
};

export type SegmentCompareRun = {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: SegmentCompareRunStatus;
  progressLabel: string | null;
  error: string | null;
  walk: SegmentCompareSlotChoice;
  edge: SegmentCompareSlotChoice;
  overlays: import("@/lib/transcript/section-overlay").TranscriptSectionOverlay[];
  walkUsage: SegmentCompareUsage | null;
  edgeUsage: SegmentCompareUsage | null;
  totalCostUsd: number | null;
};

export const SAVED_AGENDA_COMPARE_ID = "saved-agenda";

export function estimateSegmentCompareCostUsd(
  apiModel: string,
  usage: TokenUsage,
  billedAtMs = Date.now(),
): number {
  return estimateCostBreakdown(apiModel, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    billedAtMs,
  }, billedAtMs).totalCostUsd;
}
