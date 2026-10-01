import type { TokenUsage } from "@/lib/gemini/usage";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/**
 * Chat model fact resolution calls.
 * The API catalog lists this id. `deepseek-v4-flash` is no longer in that list.
 */
export const DEEPSEEK_COMPLETION_MODEL = "deepseek-flash";
/** Per-request ceiling so a hung DeepSeek call cannot block the whole validation loop. */
const DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS = 120_000;

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
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  error?: { message?: string };
};

/** One SSE payload from a DeepSeek chat stream. Keep-alives are not events. */
export type DeepSeekStreamDelta = {
  content: string;
  reasoning: string;
  finishReason: string | null;
  usage: DeepSeekChatCompletionResponse["usage"] | null;
  modelName: string | null;
};

type DeepSeekStreamChunk = {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: DeepSeekChatCompletionResponse["usage"];
};

/**
 * Reads one `data:` line from a DeepSeek stream.
 * A comment keep-alive returns null. Malformed JSON returns null.
 */
export function readDeepSeekStreamLine(line: string): DeepSeekStreamDelta | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  let parsed: DeepSeekStreamChunk;
  try {
    parsed = JSON.parse(data) as DeepSeekStreamChunk;
  } catch {
    return null;
  }
  const choice = parsed.choices?.[0];
  const piece = choice?.delta ?? choice?.message;
  const content = piece?.content ?? "";
  const reasoning = piece?.reasoning_content ?? "";
  return {
    content: typeof content === "string" ? content : "",
    reasoning: typeof reasoning === "string" ? reasoning : "",
    finishReason: choice?.finish_reason ?? null,
    usage: parsed.usage ?? null,
    modelName: parsed.model?.trim() || null,
  };
}

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
  /**
   * When true, return non-empty truncated content (finish_reason=length) so the
   * caller can salvage JSON. Default false: truncation is an error.
   */
  allowTruncated?: boolean;
  /** Abort the HTTP request after this many ms (default 120s). */
  requestTimeoutMs?: number;
  /**
   * When set, read the reply as a stream and abort if no content or reasoning
   * arrives for this long. Comment keep-alives do not count. A silent accept
   * is not a slow page, so callers can stop instead of waiting out requestTimeoutMs.
   */
  stallTimeoutMs?: number;
}): Promise<DeepSeekGenerationResult> {
  const apiKey = requireDeepSeekApiKey();
  const modelName = options.modelName.trim() || "deepseek-v4-flash";
  const maxTokens = options.maxOutputTokens ?? 4096;
  const thinkingEnabled = options.thinking !== false;

  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS;
  const body = {
    model: modelName,
    temperature: options.temperature ?? 0.15,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
    messages: [
      { role: "system", content: options.systemInstruction },
      { role: "user", content: options.userText },
    ],
  };
  if (options.stallTimeoutMs != null && options.stallTimeoutMs > 0) {
    return generateDeepSeekJsonStream({
      apiKey,
      modelName,
      maxTokens,
      requestTimeoutMs,
      stallTimeoutMs: options.stallTimeoutMs,
      allowTruncated: options.allowTruncated === true,
      body,
    });
  }
  const response = await fetch(`${deepSeekBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(requestTimeoutMs),
    body: JSON.stringify(body),
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
  const cacheHitTokens = payload.usage?.prompt_cache_hit_tokens ?? 0;
  const cacheMissTokens = payload.usage?.prompt_cache_miss_tokens ?? 0;

  if (!text) {
    throw new Error(
      finishReason === "length"
        ? `DeepSeek output was truncated with empty content (max_tokens=${maxTokens}, reasoning_tokens=${reasoningTokens}). Disable thinking or raise max_tokens.`
        : "DeepSeek returned empty content.",
    );
  }

  if (finishReason === "length" && !options.allowTruncated) {
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
      cacheHitTokens,
      cacheMissTokens,
    },
    finishReason,
  };
}

/** Request id from a DeepSeek or Cloudflare response, when one is present. */
function deepSeekRequestId(headers: Headers): string | null {
  return headers.get("x-request-id") || headers.get("x-ds-trace-id") || headers.get("cf-ray") || null;
}

/**
 * Error text when DeepSeek opens the stream and then sends only keep-alives.
 * Includes the timings so the meeting screen can show them.
 */
function silentStreamMessage(
  headersAtMs: number,
  keepAlives: number,
  requestId: string | null,
  modelName: string,
): string {
  const id = requestId ? `, request ${requestId}` : "";
  return `DeepSeek accepted the request in ${headersAtMs}ms and sent no text (${keepAlives} keep-alives, model ${modelName}${id}).`;
}

/**
 * Reads a chat completion as SSE so a keep-alive with no tokens can be aborted
 * before the whole-request ceiling.
 * Throws when the stream stays empty for stallTimeoutMs.
 */
async function generateDeepSeekJsonStream(options: {
  apiKey: string;
  modelName: string;
  maxTokens: number;
  requestTimeoutMs: number;
  stallTimeoutMs: number;
  allowTruncated: boolean;
  body: Record<string, unknown>;
}): Promise<DeepSeekGenerationResult> {
  const started = Date.now();
  const response = await fetch(`${deepSeekBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(options.requestTimeoutMs),
    body: JSON.stringify({ ...options.body, stream: true }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as DeepSeekChatCompletionResponse | null;
    throw new Error(payload?.error?.message || `DeepSeek request failed (${response.status}).`);
  }
  if (!response.body) {
    throw new Error("DeepSeek sent no text.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  let modelName = options.modelName;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let reasoningTokens = 0;
  let cacheHitTokens = 0;
  let cacheMissTokens = 0;
  let lastTokenAt = Date.now();
  let keepAlives = 0;
  const headersAt = Date.now() - started;
  const requestId = deepSeekRequestId(response.headers);
  console.info(
    `[deepseek] stream open in ${headersAt}ms status=${response.status} model=${options.modelName} request=${requestId ?? "none"}`,
  );

  try {
    while (true) {
      const elapsed = Date.now() - started;
      const silentFor = Date.now() - lastTokenAt;
      const waitMs = Math.min(options.requestTimeoutMs - elapsed, options.stallTimeoutMs - silentFor);
      if (waitMs <= 0) {
        throw content
          ? new Error("The operation was aborted due to timeout")
          : new Error(silentStreamMessage(headersAt, keepAlives, requestId, options.modelName));
      }
      const outcome = await readStreamChunk(reader, waitMs);
      if (outcome === "stall") {
        throw content
          ? new Error("The operation was aborted due to timeout")
          : new Error(silentStreamMessage(headersAt, keepAlives, requestId, options.modelName));
      }
      if (outcome.done) break;
      buffer += decoder.decode(outcome.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().startsWith(":")) keepAlives += 1;
        const delta = readDeepSeekStreamLine(line);
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          lastTokenAt = Date.now();
        }
        if (delta.reasoning) lastTokenAt = Date.now();
        if (delta.finishReason) finishReason = delta.finishReason;
        if (delta.modelName) modelName = delta.modelName;
        if (delta.usage) {
          inputTokens = delta.usage.prompt_tokens ?? inputTokens;
          outputTokens = delta.usage.completion_tokens ?? outputTokens;
          totalTokens = delta.usage.total_tokens ?? inputTokens + outputTokens;
          reasoningTokens = delta.usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
          cacheHitTokens = delta.usage.prompt_cache_hit_tokens ?? cacheHitTokens;
          cacheMissTokens = delta.usage.prompt_cache_miss_tokens ?? cacheMissTokens;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const text = content.trim();
  if (!text) {
    throw new Error(
      finishReason === "length"
        ? `DeepSeek output was truncated with empty content (max_tokens=${options.maxTokens}, reasoning_tokens=${reasoningTokens}). Disable thinking or raise max_tokens.`
        : "DeepSeek sent no text.",
    );
  }
  if (finishReason === "length" && !options.allowTruncated) {
    throw new Error(
      `DeepSeek output was truncated (finish_reason=length, max_tokens=${options.maxTokens}, reasoning_tokens=${reasoningTokens}).`,
    );
  }
  return {
    text,
    modelName,
    usage: { inputTokens, outputTokens, totalTokens, cacheHitTokens, cacheMissTokens },
    finishReason,
  };
}

/** Resolves with the next chunk, or "stall" when the deadline passes first. */
function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  waitMs: number,
): Promise<ReadableStreamReadResult<Uint8Array> | "stall"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("stall"), waitMs);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Model ids from a `/v1/models` payload. An unexpected body returns an empty list. */
export function readDeepSeekModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const id = (row as { id?: unknown }).id;
    return typeof id === "string" && id.trim() ? [id.trim()] : [];
  });
}

/** What the DeepSeek test button shows. */
export type DeepSeekPingResult = {
  ok: boolean;
  summary: string;
};

/**
 * Sends a one-line completion on the same model fact resolution uses.
 * The summary includes how fast the connection opened, or the stall detail, plus the catalog ids.
 */
export async function pingDeepSeekCompletion(): Promise<DeepSeekPingResult> {
  const catalog = await listDeepSeekModelIds();
  const catalogNote = catalogNoteFor(catalog, DEEPSEEK_COMPLETION_MODEL);
  const started = Date.now();
  try {
    const result = await generateDeepSeekJson({
      systemInstruction: "Return JSON only.",
      userText: 'Reply with {"ok":true}',
      modelName: DEEPSEEK_COMPLETION_MODEL,
      temperature: 0,
      thinking: false,
      maxOutputTokens: 32,
      requestTimeoutMs: 25_000,
      stallTimeoutMs: 20_000,
    });
    const preview = result.text.replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      ok: true,
      summary: `${result.modelName} replied in ${Date.now() - started}ms: ${preview}.${catalogNote}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "DeepSeek test failed.";
    return { ok: false, summary: `${message}${catalogNote}` };
  }
}

function catalogNoteFor(catalog: readonly string[], modelName: string): string {
  if (catalog.length === 0) return "";
  if (catalog.includes(modelName)) return ` Catalog: ${catalog.join(", ")}.`;
  return ` Catalog lists ${catalog.join(", ")}, not ${modelName}.`;
}

async function listDeepSeekModelIds(): Promise<string[]> {
  try {
    const response = await fetch(`${deepSeekBaseUrl()}/v1/models`, {
      headers: { Authorization: `Bearer ${requireDeepSeekApiKey()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    return readDeepSeekModelIds(await response.json());
  } catch {
    return [];
  }
}
