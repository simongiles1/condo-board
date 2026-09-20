import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { generateGeminiStructuredJson } from "@/lib/gemini/client";
import type { TokenUsage } from "@/lib/gemini/usage";
import {
  segmentCompareModel,
  type SegmentCompareProvider,
  type SegmentCompareSlotChoice,
} from "@/lib/meeting-v2/segment-compare-models";

/** DeepSeek thinking shares max_tokens with JSON; contact extract uses +16k. */
export const DEEPSEEK_THINKING_OUTPUT_HEADROOM = 16_384;
/** Cap so a thinking walk chunk cannot request an unbounded completion. */
export const DEEPSEEK_THINKING_OUTPUT_CAP = 32_768;
/** Gemini thinkingLevel medium burns output tokens before JSON; 512-token judges fail immediately. */
export const GEMINI_THINKING_OUTPUT_HEADROOM = 2_048;
/** Thinking completions are slower; do not share the 120s non-thinking timeout. */
export const DEEPSEEK_THINKING_REQUEST_TIMEOUT_MS = 300_000;

/**
 * Stage budgets assume non-thinking JSON. Thinking must keep leftover tokens for content.
 */
export function thinkingAwareMaxOutputTokens(options: {
  requested?: number;
  thinking: boolean;
  provider: SegmentCompareProvider;
}): number | undefined {
  if (!options.thinking) return options.requested;
  const base = options.requested ?? 4096;
  if (options.provider === "gemini") {
    return base + Math.max(GEMINI_THINKING_OUTPUT_HEADROOM, Math.ceil(base * 0.25));
  }
  const extra = Math.max(DEEPSEEK_THINKING_OUTPUT_HEADROOM, base);
  return Math.min(base + extra, DEEPSEEK_THINKING_OUTPUT_CAP);
}

export type SegmentationJsonResult = {
  text: string;
  modelName: string;
  usage: TokenUsage;
  finishReason: string | null;
};

export type SegmentationJsonFn = (options: {
  systemInstruction: string;
  userText: string;
  maxOutputTokens?: number;
  temperature?: number;
  allowTruncated?: boolean;
}) => Promise<SegmentationJsonResult>;

export function createSegmentationJsonFn(choice: SegmentCompareSlotChoice): SegmentationJsonFn {
  const catalog = segmentCompareModel(choice.modelId);
  return async (options) => {
    const maxOutputTokens = thinkingAwareMaxOutputTokens({
      requested: options.maxOutputTokens,
      thinking: choice.thinking,
      provider: catalog.provider,
    });
    if (catalog.provider === "deepseek") {
      const result = await generateDeepSeekJson({
        systemInstruction: options.systemInstruction,
        userText: options.userText,
        modelName: catalog.apiModel,
        maxOutputTokens,
        temperature: options.temperature,
        thinking: choice.thinking,
        allowTruncated: options.allowTruncated,
        requestTimeoutMs: choice.thinking ? DEEPSEEK_THINKING_REQUEST_TIMEOUT_MS : undefined,
      });
      return {
        text: result.text,
        modelName: result.modelName,
        usage: result.usage,
        finishReason: result.finishReason,
      };
    }

    const result = await generateGeminiStructuredJson({
      systemInstruction: options.systemInstruction,
      userText: options.userText,
      modelName: catalog.apiModel,
      maxOutputTokens,
      temperature: options.temperature ?? 0,
      thinking: choice.thinking,
      allowTruncated: options.allowTruncated,
    });
    return {
      text: result.text,
      modelName: result.modelName,
      usage: result.usage,
      finishReason: result.truncated ? "length" : result.finishReason ?? null,
    };
  };
}
