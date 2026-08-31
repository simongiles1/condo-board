/** Client-safe analysis settings types and helpers (no DB imports). */

import {
  billedPricingForModel,
  formatUsdPerMillion,
} from "@/lib/gemini/pricing";


export const DEFAULT_ANALYSIS_MODEL = "gemini-3.7-flash";

export type AnalysisSettings = {
  analysisModel: string;
  mergeModel: string | null;
  maxOutputTokens: number;
  extractionVersion: number;
};

export const AVAILABLE_ANALYSIS_MODELS = [
  "gemini-3.7-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
] as const;

const ANALYSIS_MODEL_LABELS: Record<
  (typeof AVAILABLE_ANALYSIS_MODELS)[number],
  string
> = {
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
};

export function formatAnalysisModelOptionLabel(
  modelId: (typeof AVAILABLE_ANALYSIS_MODELS)[number],
): string {
  const label = ANALYSIS_MODEL_LABELS[modelId];
  const pricing = billedPricingForModel(modelId);
  if (!pricing) return label;
  return `${label} ($${formatUsdPerMillion(pricing.input)}/$${formatUsdPerMillion(pricing.output)} per 1M tokens)`;
}

export function isAllowedAnalysisModel(
  value: unknown,
): value is (typeof AVAILABLE_ANALYSIS_MODELS)[number] {
  return (
    typeof value === "string" &&
    (AVAILABLE_ANALYSIS_MODELS as readonly string[]).includes(value)
  );
}

export function resolveAnalysisModel(
  model: string | null | undefined,
): (typeof AVAILABLE_ANALYSIS_MODELS)[number] {
  if (model && isAllowedAnalysisModel(model)) return model;
  return DEFAULT_ANALYSIS_MODEL;
}
