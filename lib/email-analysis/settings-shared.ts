/** Client-safe analysis settings types and helpers (no DB imports). */

export const DEFAULT_ANALYSIS_MODEL = "gemini-2.0-flash";

export type AnalysisSettings = {
  analysisModel: string;
  mergeModel: string | null;
  maxOutputTokens: number;
  extractionVersion: number;
};

export const AVAILABLE_ANALYSIS_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
] as const;

const ANALYSIS_MODEL_LABELS: Record<
  (typeof AVAILABLE_ANALYSIS_MODELS)[number],
  string
> = {
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
};

const ANALYSIS_MODEL_PRICING: Record<
  (typeof AVAILABLE_ANALYSIS_MODELS)[number],
  { input: number; output: number }
> = {
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash": { input: 1.5, output: 9 },
};

export function formatAnalysisModelOptionLabel(
  modelId: (typeof AVAILABLE_ANALYSIS_MODELS)[number],
): string {
  const label = ANALYSIS_MODEL_LABELS[modelId];
  const pricing = ANALYSIS_MODEL_PRICING[modelId];
  return `${label} ($${pricing.input.toFixed(2)}/$${pricing.output.toFixed(2)} per 1M tokens)`;
}

export function isAllowedAnalysisModel(
  value: unknown,
): value is (typeof AVAILABLE_ANALYSIS_MODELS)[number] {
  return (
    typeof value === "string" &&
    (AVAILABLE_ANALYSIS_MODELS as readonly string[]).includes(value)
  );
}
