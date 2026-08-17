import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import {
  getEventHighlightModelMeta,
  getEventHighlightPassConfig,
  resolveEventHighlightModel,
  type EventHighlightModelId,
} from "@/lib/email-analysis/event-highlight-models";
import {
  buildEventHighlightSystemPrompt,
  buildEventHighlightUserPrompt,
  chunkEventHighlightText,
  emptyEventHighlightExtraction,
  mergeEventHighlightExtractions,
  parseEventHighlightJson,
  type EventHighlightEmailContext,
  type EventHighlightExtraction,
} from "@/lib/email-analysis/event-highlight-shared";

export {
  emptyEventHighlightExtraction,
  type EventHighlightExtraction,
} from "@/lib/email-analysis/event-highlight-shared";

type EventHighlightCallResult = {
  extraction: EventHighlightExtraction;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
};

async function runEventHighlightLlm(params: {
  systemInstruction: string;
  userText: string;
  modelId: EventHighlightModelId;
  step: string;
}): Promise<{
  text: string;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
}> {
  const meta = getEventHighlightModelMeta(params.modelId);
  const passConfig = getEventHighlightPassConfig(params.modelId, 1);
  const result =
    meta.provider === "deepseek"
      ? await generateDeepSeekJson({
          systemInstruction: params.systemInstruction,
          userText: params.userText,
          modelName: passConfig.apiModelName,
          maxOutputTokens: passConfig.maxOutputTokens,
          thinking: passConfig.thinking,
        })
      : await generateEmailExtraction({
          systemInstruction: params.systemInstruction,
          userText: params.userText,
          modelName: passConfig.apiModelName,
          maxOutputTokens: passConfig.maxOutputTokens,
          step: params.step,
        });

  return {
    text: result.text,
    modelName: result.modelName,
    usage: result.usage,
    costUsd: estimateCostUsd(result.modelName, result.usage),
  };
}

function emptyUsageResult(modelName: string): EventHighlightCallResult {
  return {
    extraction: emptyEventHighlightExtraction(),
    modelName,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    costUsd: 0,
  };
}

function resolveExcerptChunks(
  highlightedText: string,
  modelId: EventHighlightModelId,
): string[] {
  const meta = getEventHighlightModelMeta(modelId);
  const trimmed = highlightedText.trim();
  if (!trimmed) return [];
  if (!meta.chunking) return [trimmed];
  const chunks = chunkEventHighlightText(trimmed, meta.chunking);
  return chunks.length > 0 ? chunks : [trimmed];
}

/**
 * One calendar-focused harvest pass. Chunked models = N calls, usage summed.
 */
export async function extractEventHighlightsFromText(
  input: EventHighlightEmailContext,
  modelId?: string | null,
): Promise<EventHighlightCallResult> {
  const resolvedModel = resolveEventHighlightModel(modelId);
  const chunks = resolveExcerptChunks(input.highlightedText, resolvedModel);
  if (chunks.length === 0) {
    return emptyUsageResult(
      getEventHighlightPassConfig(resolvedModel, 1).apiModelName,
    );
  }

  const systemInstruction = buildEventHighlightSystemPrompt();
  const parts: EventHighlightCallResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const step =
      chunks.length === 1
        ? "event_highlight"
        : `event_highlight_chunk_${i + 1}_of_${chunks.length}`;
    const llm = await runEventHighlightLlm({
      systemInstruction,
      userText: buildEventHighlightUserPrompt({
        ...input,
        highlightedText: chunk,
      }),
      modelId: resolvedModel,
      step,
    });
    parts.push({
      extraction: parseEventHighlightJson(llm.text),
      modelName: llm.modelName,
      usage: llm.usage,
      costUsd: llm.costUsd,
    });
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let modelName = parts[0]?.modelName ?? resolvedModel;
  for (const part of parts) {
    inputTokens += part.usage.inputTokens;
    outputTokens += part.usage.outputTokens;
    totalTokens += part.usage.totalTokens;
    costUsd += part.costUsd;
    if (part.modelName) modelName = part.modelName;
  }

  return {
    extraction: mergeEventHighlightExtractions(
      parts.map((part) => part.extraction),
    ),
    modelName,
    usage: { inputTokens, outputTokens, totalTokens },
    costUsd,
  };
}
