import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { generateGeminiStructuredJson } from "@/lib/gemini/client";
import type { TokenUsage } from "@/lib/gemini/usage";
import {
  segmentCompareModel,
  type SegmentCompareSlotChoice,
} from "@/lib/meeting-v2/segment-compare-models";

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
    if (catalog.provider === "deepseek") {
      const result = await generateDeepSeekJson({
        systemInstruction: options.systemInstruction,
        userText: options.userText,
        modelName: catalog.apiModel,
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature,
        thinking: choice.thinking,
        allowTruncated: options.allowTruncated,
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
      maxOutputTokens: options.maxOutputTokens,
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
