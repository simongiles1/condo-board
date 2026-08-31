/** Client-safe contact-highlight model catalog (no provider SDK imports). */

import {
  billedPricingForModel,
  formatUsdPerMillion,
} from "@/lib/gemini/pricing";


export const CONTACT_HIGHLIGHT_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.1-pro-preview",
  "deepseek-v4-flash",
  "deepseek-v4-flash-thinking",
  "deepseek-v4-flash-then-thinking",
  "deepseek-v4-flash-chunked",
] as const;

export type ContactHighlightModelId =
  (typeof CONTACT_HIGHLIGHT_MODELS)[number];

export type ContactHighlightPass = 1 | 2 | 3 | 4;

export const DEFAULT_CONTACT_HIGHLIGHT_MODEL: ContactHighlightModelId =
  "gemini-3.7-flash";

export type ContactHighlightPassConfig = {
  /** Provider API model id (may differ from catalog id for thinking variants). */
  apiModelName: string;
  /** DeepSeek V4 extended thinking; ignored for Gemini. */
  thinking: boolean;
  /** Higher for thinking so reasoning cannot exhaust the JSON budget. */
  maxOutputTokens: number;
};

export type ContactHighlightChunkingConfig = {
  minChars: number;
  maxChars: number;
};

type ContactHighlightModelMeta = {
  label: string;
  /** Nested 2nd-pass row label; defaults to generic "2nd pass". */
  secondPassLabel: string;
  /** Nested 3rd-pass (fingerprint) row label. */
  thirdPassLabel: string;
  /** Nested 4th-pass (merge) row label. */
  fourthPassLabel: string;
  provider: "gemini" | "deepseek";
  /** USD per 1M tokens (standard / cache-miss rates). */
  inputPerMillion: number;
  outputPerMillion: number;
  firstPass: ContactHighlightPassConfig;
  secondPass: ContactHighlightPassConfig;
  /** Fingerprint pass; usually matches secondPass (thinking when used for misses). */
  thirdPass: ContactHighlightPassConfig;
  /** Merge pass across emails; usually matches thirdPass. */
  fourthPass: ContactHighlightPassConfig;
  /**
   * When set, each email is split into paragraph/sentence chunks in this
   * character range; one LLM call per chunk (system prompt repeated).
   * Pass 3/4 never chunk — fingerprints/merge need the full card set.
   */
  chunking: ContactHighlightChunkingConfig | null;
};

function samePassConfig(
  config: ContactHighlightPassConfig,
): Pick<
  ContactHighlightModelMeta,
  "firstPass" | "secondPass" | "thirdPass" | "fourthPass"
> {
  return {
    firstPass: config,
    secondPass: { ...config },
    thirdPass: { ...config },
    fourthPass: { ...config },
  };
}

const CONTACT_HIGHLIGHT_MODEL_META: Record<
  ContactHighlightModelId,
  ContactHighlightModelMeta
> = {
  "gemini-3.7-flash": {
    label: "Gemini 3.7 Flash",
    secondPassLabel: "2nd pass",
    thirdPassLabel: "3rd pass · fingerprints",
    fourthPassLabel: "4th pass · merge",
    provider: "gemini",
    inputPerMillion: 1.5,
    outputPerMillion: 7.5,
    chunking: null,
    ...samePassConfig({
      apiModelName: "gemini-3.7-flash",
      thinking: false,
      maxOutputTokens: 4096,
    }),
  },
  "gemini-3.6-flash": {
    label: "Gemini 3.6 Flash",
    secondPassLabel: "2nd pass",
    thirdPassLabel: "3rd pass · fingerprints",
    fourthPassLabel: "4th pass · merge",
    provider: "gemini",
    inputPerMillion: 1.5,
    outputPerMillion: 7.5,
    chunking: null,
    ...samePassConfig({
      apiModelName: "gemini-3.6-flash",
      thinking: false,
      maxOutputTokens: 4096,
    }),
  },
  "gemini-3.1-pro-preview": {
    label: "Gemini 3.1 Pro",
    secondPassLabel: "2nd pass",
    thirdPassLabel: "3rd pass · fingerprints",
    fourthPassLabel: "4th pass · merge",
    provider: "gemini",
    inputPerMillion: 2,
    outputPerMillion: 12,
    chunking: null,
    ...samePassConfig({
      apiModelName: "gemini-3.1-pro-preview",
      thinking: false,
      maxOutputTokens: 4096,
    }),
  },
  "deepseek-v4-flash": {
    label: "DeepSeek V4 Flash 0731",
    secondPassLabel: "2nd pass",
    thirdPassLabel: "3rd pass · fingerprints",
    fourthPassLabel: "4th pass · merge",
    provider: "deepseek",
    inputPerMillion: 0.14,
    outputPerMillion: 0.28,
    chunking: null,
    ...samePassConfig({
      apiModelName: "deepseek-v4-flash",
      thinking: false,
      maxOutputTokens: 4096,
    }),
  },
  "deepseek-v4-flash-thinking": {
    label: "DeepSeek V4 Flash 0731 · Extended Thinking",
    secondPassLabel: "2nd pass",
    thirdPassLabel: "3rd pass · fingerprints",
    fourthPassLabel: "4th pass · merge",
    provider: "deepseek",
    inputPerMillion: 0.14,
    outputPerMillion: 0.28,
    chunking: null,
    ...samePassConfig({
      apiModelName: "deepseek-v4-flash",
      thinking: true,
      // Reasoning tokens count against max_tokens; keep headroom for JSON content.
      maxOutputTokens: 16384,
    }),
  },
  /** Pass 1 = no thinking; pass 2/3/4 = Extended Thinking (same API model). */
  "deepseek-v4-flash-then-thinking": {
    label: "DeepSeek V4 Flash 0731 → then Thinking",
    secondPassLabel: "2nd pass · Extended Thinking",
    thirdPassLabel: "3rd pass · fingerprints · Thinking",
    fourthPassLabel: "4th pass · merge · Thinking",
    provider: "deepseek",
    inputPerMillion: 0.14,
    outputPerMillion: 0.28,
    chunking: null,
    firstPass: {
      apiModelName: "deepseek-v4-flash",
      thinking: false,
      maxOutputTokens: 4096,
    },
    secondPass: {
      apiModelName: "deepseek-v4-flash",
      thinking: true,
      maxOutputTokens: 16384,
    },
    thirdPass: {
      apiModelName: "deepseek-v4-flash",
      thinking: true,
      maxOutputTokens: 16384,
    },
    fourthPass: {
      apiModelName: "deepseek-v4-flash",
      thinking: true,
      maxOutputTokens: 16384,
    },
  },
  /** No thinking; each email split into ~500–1000 char chunks (multi-call). */
  "deepseek-v4-flash-chunked": {
    label: "DeepSeek V4 Flash 0731 · Chunked",
    secondPassLabel: "2nd pass · chunked",
    thirdPassLabel: "3rd pass · fingerprints (full email)",
    fourthPassLabel: "4th pass · merge",
    provider: "deepseek",
    inputPerMillion: 0.14,
    outputPerMillion: 0.28,
    chunking: { minChars: 500, maxChars: 1000 },
    ...samePassConfig({
      apiModelName: "deepseek-v4-flash",
      thinking: false,
      maxOutputTokens: 4096,
    }),
  },
};

export function isContactHighlightModel(
  value: unknown,
): value is ContactHighlightModelId {
  return (
    typeof value === "string" &&
    (CONTACT_HIGHLIGHT_MODELS as readonly string[]).includes(value)
  );
}

export function resolveContactHighlightModel(
  value: string | null | undefined,
): ContactHighlightModelId {
  if (isContactHighlightModel(value)) return value;
  return DEFAULT_CONTACT_HIGHLIGHT_MODEL;
}

export function getContactHighlightModelMeta(modelId: ContactHighlightModelId) {
  const meta = CONTACT_HIGHLIGHT_MODEL_META[modelId];
  const billed = billedPricingForModel(modelId);
  if (!billed) return meta;
  return {
    ...meta,
    inputPerMillion: billed.input,
    outputPerMillion: billed.output,
  };
}

export function getContactHighlightPassConfig(
  modelId: ContactHighlightModelId,
  pass: ContactHighlightPass = 1,
): ContactHighlightPassConfig {
  const meta = CONTACT_HIGHLIGHT_MODEL_META[modelId];
  if (pass === 4) return meta.fourthPass;
  if (pass === 3) return meta.thirdPass;
  if (pass === 2) return meta.secondPass;
  return meta.firstPass;
}

export function formatContactHighlightModelOptionLabel(
  modelId: ContactHighlightModelId,
): string {
  const meta = getContactHighlightModelMeta(modelId);
  return `${meta.label} ($${formatUsdPerMillion(meta.inputPerMillion)}/$${formatUsdPerMillion(meta.outputPerMillion)} per 1M tokens)`;
}

export function contactHighlightModelProvider(
  modelId: ContactHighlightModelId,
): "gemini" | "deepseek" {
  return CONTACT_HIGHLIGHT_MODEL_META[modelId].provider;
}
