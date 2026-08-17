import { generateDeepSeekJson } from "@/lib/deepseek/client";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { estimateCostUsd } from "@/lib/gemini/usage";
import {
  getTodoHighlightModelMeta,
  getTodoHighlightPassConfig,
  resolveTodoHighlightModel,
  type TodoHighlightModelId,
} from "@/lib/email-analysis/todo-highlight-models";
import {
  buildTodoHighlightSystemPrompt,
  buildTodoHighlightUserPrompt,
  chunkTodoHighlightText,
  emptyTodoHighlightExtraction,
  mergeTodoHighlightExtractions,
  parseTodoHighlightJson,
  type TodoHighlightEmailContext,
  type TodoHighlightExtraction,
} from "@/lib/email-analysis/todo-highlight-shared";

export {
  emptyTodoHighlightExtraction,
  type TodoHighlightExtraction,
} from "@/lib/email-analysis/todo-highlight-shared";

type TodoHighlightCallResult = {
  extraction: TodoHighlightExtraction;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
};

async function runTodoHighlightLlm(params: {
  systemInstruction: string;
  userText: string;
  modelId: TodoHighlightModelId;
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
  const meta = getTodoHighlightModelMeta(params.modelId);
  const passConfig = getTodoHighlightPassConfig(params.modelId, 1);
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

function emptyUsageResult(modelName: string): TodoHighlightCallResult {
  return {
    extraction: emptyTodoHighlightExtraction(),
    modelName,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    costUsd: 0,
  };
}

function resolveExcerptChunks(
  highlightedText: string,
  modelId: TodoHighlightModelId,
): string[] {
  const meta = getTodoHighlightModelMeta(modelId);
  const trimmed = highlightedText.trim();
  if (!trimmed) return [];
  if (!meta.chunking) return [trimmed];
  const chunks = chunkTodoHighlightText(trimmed, meta.chunking);
  return chunks.length > 0 ? chunks : [trimmed];
}

/** One to-do harvest pass. Chunked models = N calls, usage summed. */
export async function extractTodoHighlightsFromText(
  input: TodoHighlightEmailContext,
  modelId?: string | null,
): Promise<TodoHighlightCallResult> {
  const resolvedModel = resolveTodoHighlightModel(modelId);
  const chunks = resolveExcerptChunks(input.highlightedText, resolvedModel);
  if (chunks.length === 0) {
    return emptyUsageResult(
      getTodoHighlightPassConfig(resolvedModel, 1).apiModelName,
    );
  }

  const systemInstruction = buildTodoHighlightSystemPrompt();
  const parts: TodoHighlightCallResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const step =
      chunks.length === 1
        ? "todo_highlight"
        : `todo_highlight_chunk_${i + 1}_of_${chunks.length}`;
    const llm = await runTodoHighlightLlm({
      systemInstruction,
      userText: buildTodoHighlightUserPrompt({
        ...input,
        highlightedText: chunk,
      }),
      modelId: resolvedModel,
      step,
    });
    parts.push({
      extraction: parseTodoHighlightJson(llm.text),
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
    extraction: mergeTodoHighlightExtractions(
      parts.map((part) => part.extraction),
    ),
    modelName,
    usage: { inputTokens, outputTokens, totalTokens },
    costUsd,
  };
}
