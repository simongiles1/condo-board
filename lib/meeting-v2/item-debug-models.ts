import {
  SEGMENT_COMPARE_MODELS,
  SEGMENT_COMPARE_MODEL_IDS,
  isSegmentCompareModelId,
  type SegmentCompareModelId,
} from "@/lib/meeting-v2/segment-compare-models";

export const ITEM_DEBUG_STEP_KEYS = [
  "evidence",
  "facts",
  "investigate",
  "validate",
  "draft",
] as const;

export type ItemDebugStepKey = (typeof ITEM_DEBUG_STEP_KEYS)[number];

export type ItemDebugStepKind = "deterministic" | "llm";

export type ItemDebugStepMeta = {
  key: ItemDebugStepKey;
  label: string;
  shortLabel: string;
  kind: ItemDebugStepKind;
  description: string;
  requires: ItemDebugStepKey[];
};

export const ITEM_DEBUG_STEPS: ItemDebugStepMeta[] = [
  {
    key: "evidence",
    label: "1. Evidence context",
    shortLabel: "Evidence",
    kind: "deterministic",
    description:
      "Loads the assembled transcript cues and board-package chunks for this agenda item. No LLM.",
    requires: [],
  },
  {
    key: "facts",
    label: "2A. Fact resolution",
    shortLabel: "Facts",
    kind: "llm",
    description: "Extracts candidate amounts, contractors, approvals, and dates from the evidence.",
    requires: ["evidence"],
  },
  {
    key: "investigate",
    label: "2B. Investigation",
    shortLabel: "Investigate",
    kind: "llm",
    description: "Writes the structured investigation (outcome, decisions, motion, actions).",
    requires: ["facts"],
  },
  {
    key: "validate",
    label: "3. Validation",
    shortLabel: "Validate",
    kind: "llm",
    description: "Independent review of whether the investigation is supported by the evidence.",
    requires: ["investigate"],
  },
  {
    key: "draft",
    label: "4. Rendered minutes",
    shortLabel: "Draft",
    kind: "deterministic",
    description: "Renders a minutes snippet from this run's investigation. No LLM.",
    requires: ["investigate"],
  },
];

export const ITEM_DEBUG_MODELS = SEGMENT_COMPARE_MODELS;
export const ITEM_DEBUG_MODEL_IDS = SEGMENT_COMPARE_MODEL_IDS;
export type ItemDebugModelId = SegmentCompareModelId;

export function isItemDebugModelId(value: string): value is ItemDebugModelId {
  return isSegmentCompareModelId(value);
}

export function itemDebugStepMeta(key: ItemDebugStepKey): ItemDebugStepMeta {
  const found = ITEM_DEBUG_STEPS.find((step) => step.key === key);
  if (!found) throw new Error(`Unknown item debug step: ${key}`);
  return found;
}

export function isItemDebugStepKey(value: string): value is ItemDebugStepKey {
  return (ITEM_DEBUG_STEP_KEYS as readonly string[]).includes(value);
}

export type ItemDebugStepStatus = "idle" | "running" | "completed" | "failed";

export type ItemDebugUsage = {
  modelId: ItemDebugModelId | null;
  apiModel: string | null;
  thinking: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  costUsd: number;
};

export type ItemDebugStep = {
  key: ItemDebugStepKey;
  status: ItemDebugStepStatus;
  modelId: ItemDebugModelId | null;
  thinking: boolean;
  systemPrompt: string;
  userPrompt: string;
  outputText: string | null;
  parsedOutput: unknown;
  usage: ItemDebugUsage | null;
  durationMs: number | null;
  error: string | null;
  ranAt: string | null;
};

export type ItemDebugRunStatus = "idle" | "running" | "completed" | "failed";

export type ItemDebugRun = {
  id: string;
  meetingId: string;
  agendaItemId: string;
  status: ItemDebugRunStatus;
  error: string | null;
  steps: ItemDebugStep[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
};

export type ItemDebugRunSummary = {
  id: string;
  status: ItemDebugRunStatus;
  error: string | null;
  completedStepKeys: ItemDebugStepKey[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
};

export function emptyItemDebugUsage(modelId: ItemDebugModelId | null, thinking: boolean): ItemDebugUsage {
  return {
    modelId,
    apiModel: null,
    thinking,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

export function summarizeItemDebugRun(run: ItemDebugRun): ItemDebugRunSummary {
  return {
    id: run.id,
    status: run.status,
    error: run.error,
    completedStepKeys: run.steps.filter((step) => step.status === "completed").map((step) => step.key),
    totalInputTokens: run.totalInputTokens,
    totalOutputTokens: run.totalOutputTokens,
    totalCostUsd: run.totalCostUsd,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function recomputeItemDebugRunTotals(steps: ItemDebugStep[]): {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  for (const step of steps) {
    if (!step.usage) continue;
    totalInputTokens += step.usage.inputTokens;
    totalOutputTokens += step.usage.outputTokens;
    totalCostUsd += step.usage.costUsd;
  }
  return { totalInputTokens, totalOutputTokens, totalCostUsd };
}

export function missingPrerequisite(
  steps: ItemDebugStep[],
  key: ItemDebugStepKey,
): ItemDebugStepKey | null {
  const required = itemDebugStepMeta(key).requires;
  for (const req of required) {
    const step = steps.find((entry) => entry.key === req);
    if (!step || step.status !== "completed") return req;
  }
  return null;
}

/** Index of the first pipeline step that is not completed (or length if all done). */
export function firstIncompleteItemDebugStepIndex(steps: ItemDebugStep[]): number {
  for (let index = 0; index < ITEM_DEBUG_STEPS.length; index += 1) {
    const meta = ITEM_DEBUG_STEPS[index];
    const step = steps.find((entry) => entry.key === meta.key);
    if (!step || step.status !== "completed") return index;
  }
  return ITEM_DEBUG_STEPS.length;
}

/** Steps at or before the current pipeline frontier are navigable for review. */
export function isItemDebugStepNavigable(steps: ItemDebugStep[], key: ItemDebugStepKey): boolean {
  const stepIndex = ITEM_DEBUG_STEPS.findIndex((meta) => meta.key === key);
  if (stepIndex < 0) return false;
  return stepIndex <= firstIncompleteItemDebugStepIndex(steps);
}

export function formatItemDebugRunLabel(run: ItemDebugRunSummary, indexFromNewest: number): string {
  const when = new Date(run.createdAt);
  const stamp = Number.isNaN(when.getTime())
    ? run.createdAt
    : when.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  const prefix = indexFromNewest === 0 ? "Latest" : `Run ${indexFromNewest + 1}`;
  return `${prefix} · ${stamp}`;
}
