import type { TokenUsage } from "@/lib/gemini/usage";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function requireDeepSeekApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key?.trim()) {
    throw new Error(
      "DEEPSEEK_API_KEY is missing. Add it to .env.local (see .env.local.example).",
    );
  }
  return key.trim();
}

function deepSeekBaseUrl(): string {
  const configured = process.env.DEEPSEEK_API_BASE_URL?.trim();
  return (configured || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");
}

export type DeepSeekGenerationResult = {
  text: string;
  modelName: string;
  usage: TokenUsage;
  finishReason: string | null;
};

type DeepSeekChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  error?: { message?: string };
};

/**
 * OpenAI-compatible chat completion against DeepSeek (JSON response expected).
 *
 * DeepSeek V4 thinking is enabled by default and counts against max_tokens.
 * For short structured JSON tasks, pass `thinking: false` so reasoning cannot
 * exhaust the budget and leave `content` empty.
 */
export async function generateDeepSeekJson(options: {
  systemInstruction: string;
  userText: string;
  modelName: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** V4 thinking mode. Default true (API default). Prefer false for JSON extract. */
  thinking?: boolean;
}): Promise<DeepSeekGenerationResult> {
  const apiKey = requireDeepSeekApiKey();
  const modelName = options.modelName.trim() || "deepseek-v4-flash";
  const maxTokens = options.maxOutputTokens ?? 4096;
  const thinkingEnabled = options.thinking !== false;

  const response = await fetch(`${deepSeekBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      temperature: options.temperature ?? 0.15,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
      messages: [
        { role: "system", content: options.systemInstruction },
        { role: "user", content: options.userText },
      ],
    }),
  });

  const payload = (await response.json()) as DeepSeekChatCompletionResponse;
  if (!response.ok) {
    const message =
      payload.error?.message ||
      `DeepSeek request failed (${response.status}).`;
    throw new Error(message);
  }

  const choice = payload.choices?.[0];
  const finishReason = choice?.finish_reason ?? null;
  const text = choice?.message?.content?.trim() ?? "";
  const inputTokens = payload.usage?.prompt_tokens ?? 0;
  const outputTokens = payload.usage?.completion_tokens ?? 0;
  const totalTokens =
    payload.usage?.total_tokens ?? inputTokens + outputTokens;
  const reasoningTokens =
    payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

  if (!text) {
    throw new Error(
      finishReason === "length"
        ? `DeepSeek output was truncated with empty content (max_tokens=${maxTokens}, reasoning_tokens=${reasoningTokens}). Disable thinking or raise max_tokens.`
        : "DeepSeek returned empty content.",
    );
  }

  if (finishReason === "length") {
    throw new Error(
      `DeepSeek output was truncated (finish_reason=length, max_tokens=${maxTokens}, reasoning_tokens=${reasoningTokens}).`,
    );
  }

  return {
    text,
    modelName: payload.model?.trim() || modelName,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
    },
    finishReason,
  };
}
