import {
  FinishReason,
  GoogleGenerativeAI,
  type GenerationConfig,
  type ResponseSchema,
  type UsageMetadata,
} from "@google/generative-ai";

import { minutesSchemaV2GeminiSlim } from "@/lib/minutes/schema-v2-gemini";
import {
  extractTokenUsage,
  type GeminiUsageCall,
  type TokenUsage,
} from "@/lib/gemini/usage";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim()) {
    throw new Error(
      "GEMINI_API_KEY is missing. Copy .env.local.example to .env.local.",
    );
  }
  return key;
}

export type GeminiGenerationResult = {
  text: string;
  finishReason?: FinishReason;
  truncated: boolean;
  modelName: string;
  usage: TokenUsage;
  usageCalls: GeminiUsageCall[];
};

/** Gemini 3+ models use thinkingLevel, not thinkingBudget — omit thinkingConfig. */
function buildGenerationConfig(options: {
  modelName: string;
  maxOutputTokens: number;
  temperature: number;
}): GenerationConfig {
  return {
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
  };
}

function isSchemaRejectedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /400|invalid argument|INVALID_ARGUMENT/i.test(error.message);
}

function buildUsageCall(
  step: string,
  modelName: string,
  usageMetadata?: UsageMetadata,
): GeminiUsageCall {
  const usage = extractTokenUsage(usageMetadata);
  return {
    step,
    modelName,
    ...usage,
  };
}

function parseGenerationResult(
  response: {
    text(): string;
    candidates?: Array<{ finishReason?: FinishReason }>;
    usageMetadata?: UsageMetadata;
  },
  options: { modelName: string; step: string },
): GeminiGenerationResult {
  const finishReason = response.candidates?.[0]?.finishReason;
  const truncated = finishReason === FinishReason.MAX_TOKENS;
  const usageCall = buildUsageCall(
    options.step,
    options.modelName,
    response.usageMetadata,
  );

  return {
    text: response.text().trim(),
    finishReason,
    truncated,
    modelName: options.modelName,
    usage: {
      inputTokens: usageCall.inputTokens,
      outputTokens: usageCall.outputTokens,
      totalTokens: usageCall.totalTokens,
    },
    usageCalls: [usageCall],
  };
}

export async function generateWithSystemPrompt(options: {
  systemInstruction: string;
  userText: string;
  /** Optional explicit model override; otherwise env-specific or flash default */
  modelName?: string;
  maxOutputTokens?: number;
}): Promise<GeminiGenerationResult> {
  const client = new GoogleGenerativeAI(requireApiKey());
  const modelName =
    options.modelName?.trim() ||
    process.env.GEMINI_MODEL_MINUTES?.trim() ||
    DEFAULT_GEMINI_MODEL;

  const maxOutputTokens =
    options.maxOutputTokens ??
    Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_MINUTES ?? 65536);

  const generativeModel = client.getGenerativeModel({
    model: modelName,
    systemInstruction: options.systemInstruction,
    generationConfig: buildGenerationConfig({
      modelName,
      maxOutputTokens,
      temperature: 0.2,
    }),
  });

  const result = await generativeModel.generateContent([
    `USER INPUT\n\n${options.userText}`,
  ]);

  return parseGenerationResult(result.response, {
    modelName,
    step: "generation",
  });
}

export async function generateTodos(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
}): Promise<GeminiGenerationResult> {
  const client = new GoogleGenerativeAI(requireApiKey());
  const modelName =
    options.modelName?.trim() ||
    process.env.GEMINI_MODEL_TODOS?.trim() ||
    process.env.GEMINI_MODEL_MINUTES?.trim() ||
    DEFAULT_GEMINI_MODEL;

  const maxOutputTokens = Number(
    process.env.GEMINI_MAX_OUTPUT_TOKENS_TODOS ?? 8192,
  );

  const generativeModel = client.getGenerativeModel({
    model: modelName,
    systemInstruction: options.systemInstruction,
    generationConfig: buildGenerationConfig({
      modelName,
      maxOutputTokens,
      temperature: 0.15,
    }),
  });

  const result = await generativeModel.generateContent([
    `USER INPUT\n\n${options.userText}`,
  ]);

  return parseGenerationResult(result.response, {
    modelName,
    step: "todos",
  });
}

const MAX_MINUTES_CONTINUATIONS = 2;

export async function generateMinutesWithContinuation(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
}): Promise<GeminiGenerationResult & { continuationCount: number }> {
  let combinedText = "";
  let continuationCount = 0;
  let finishReason: FinishReason | undefined;
  let truncated = false;
  const usageCalls: GeminiUsageCall[] = [];
  let modelName =
    options.modelName?.trim() ||
    process.env.GEMINI_MODEL_MINUTES?.trim() ||
    DEFAULT_GEMINI_MODEL;

  let userText = options.userText;

  for (let attempt = 0; attempt <= MAX_MINUTES_CONTINUATIONS; attempt++) {
    const result = await generateWithSystemPrompt({
      systemInstruction: options.systemInstruction,
      userText,
      modelName: options.modelName,
    });

    modelName = result.modelName;
    usageCalls.push(...result.usageCalls);
    finishReason = result.finishReason;
    truncated = result.truncated;

    if (attempt === 0) {
      combinedText = result.text;
    } else {
      combinedText = stitchContinuedMinutes(combinedText, result.text);
      continuationCount = attempt;
    }

    if (!result.truncated) {
      break;
    }

    userText = `The previous response was cut off because the output token limit was reached.

Continue the meeting minutes EXACTLY where the partial output ends. Do not repeat any content already written. Output only the continuation inside a single Markdown fenced code block.

PARTIAL OUTPUT SO FAR
<<<
${combinedText}
>>>`;
  }

  const usage = usageCalls.reduce(
    (acc, call) => ({
      inputTokens: acc.inputTokens + call.inputTokens,
      outputTokens: acc.outputTokens + call.outputTokens,
      totalTokens: acc.totalTokens + call.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );

  return {
    text: combinedText,
    finishReason,
    truncated,
    continuationCount,
    modelName,
    usage,
    usageCalls,
  };
}

function stitchContinuedMinutes(existing: string, continuation: string): string {
  const cont = continuation.trim();

  const fenced =
    /^```(?:markdown|md)?\s*\r?\n([\s\S]*)\r?\n```\s*$/im.exec(cont);
  const continuationBody = fenced ? fenced[1].trim() : cont;

  const existingTrimmed = existing.trimEnd();
  const closingFence = /\r?\n```\s*$/;
  const withoutClosingFence = existingTrimmed.replace(closingFence, "");

  return `${withoutClosingFence}\n${continuationBody}`.trim();
}

/** Append continuation JSON (inside or outside fences) to partial fenced output. */
function stitchContinuedJson(existing: string, continuation: string): string {
  const cont = continuation.trim();

  const fenced =
    /^```(?:json)?\s*\r?\n([\s\S]*)\r?\n```\s*$/im.exec(cont);
  let continuationBody = fenced ? fenced[1].trim() : cont;
  if (!fenced) {
    continuationBody = continuationBody
      .replace(/^```(?:json)?[^\n]*\n?/i, "")
      .replace(/\r?\n```\s*$/i, "")
      .trim();
  }

  const existingTrimmed = existing.trimEnd();
  const withoutClosingFence = existingTrimmed.replace(/\r?\n```\s*$/i, "");

  return `${withoutClosingFence}${continuationBody}`.trim();
}

const MAX_MINUTES_V2_RETRIES = 1;

/** Structured JSON minutes extraction (schema v2). */
export async function generateMinutesV2(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
  responseSchema?: ResponseSchema | null;
}): Promise<
  GeminiGenerationResult & {
    retryCount: number;
    usedResponseSchema: boolean;
  }
> {
  const client = new GoogleGenerativeAI(requireApiKey());
  const modelName =
    options.modelName?.trim() ||
    process.env.GEMINI_MODEL_MINUTES?.trim() ||
    DEFAULT_GEMINI_MODEL;

  const maxOutputTokens = Number(
    process.env.GEMINI_MAX_OUTPUT_TOKENS_MINUTES ?? 65536,
  );

  const baseConfig = buildGenerationConfig({
    modelName,
    maxOutputTokens,
    temperature: 0.2,
  });

  let useSchema =
    options.responseSchema !== null &&
    (options.responseSchema ?? minutesSchemaV2GeminiSlim);

  let combinedText = "";
  let retryCount = 0;
  let finishReason: FinishReason | undefined;
  let truncated = false;
  const usageCalls: GeminiUsageCall[] = [];
  let userText = options.userText;

  for (let attempt = 0; attempt <= MAX_MINUTES_V2_RETRIES; attempt++) {
    const generationConfig: GenerationConfig = {
      ...baseConfig,
      responseMimeType: "application/json",
      ...(useSchema ? { responseSchema: useSchema } : {}),
    };

    const generativeModel = client.getGenerativeModel({
      model: modelName,
      systemInstruction: options.systemInstruction,
      generationConfig,
    });

    let parsed: GeminiGenerationResult;
    try {
      const result = await generativeModel.generateContent([
        `USER INPUT\n\n${userText}`,
      ]);
      parsed = parseGenerationResult(result.response, {
        modelName,
        step: attempt === 0 ? "minutes" : "minutes_continuation",
      });
    } catch (error) {
      if (useSchema && isSchemaRejectedError(error)) {
        useSchema = false;
        continue;
      }
      throw error;
    }

    usageCalls.push(...parsed.usageCalls);
    finishReason = parsed.finishReason;
    truncated = parsed.truncated;

    if (attempt === 0) {
      combinedText = parsed.text;
    } else {
      combinedText = stitchContinuedJson(combinedText, parsed.text);
      retryCount = attempt;
    }

    if (!parsed.truncated) {
      break;
    }

    userText = `The previous JSON response was truncated because the output token limit was reached.

Continue the JSON object EXACTLY where the partial output ends. Do not repeat keys or content already written. Output only valid JSON (no markdown fences) that completes the document.

PARTIAL JSON SO FAR
<<<
${combinedText}
>>>`;
  }

  const usage = usageCalls.reduce(
    (acc, call) => ({
      inputTokens: acc.inputTokens + call.inputTokens,
      outputTokens: acc.outputTokens + call.outputTokens,
      totalTokens: acc.totalTokens + call.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );

  return {
    text: combinedText,
    finishReason,
    truncated,
    retryCount,
    usedResponseSchema: Boolean(useSchema),
    modelName,
    usage,
    usageCalls,
  };
}

const MAX_OMISSIONS_CONTINUATIONS = 1;

/** Omissions analysis — structured JSON comparison of transcript vs minutes. */
export async function generateOmissionsAnalysis(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
}): Promise<GeminiGenerationResult & { retryCount: number }> {
  const client = new GoogleGenerativeAI(requireApiKey());
  const modelName =
    options.modelName?.trim() ||
    process.env.GEMINI_MODEL_OMISSIONS?.trim() ||
    process.env.GEMINI_MODEL_MINUTES?.trim() ||
    DEFAULT_GEMINI_MODEL;

  const maxOutputTokens = Number(
    process.env.GEMINI_MAX_OUTPUT_TOKENS_OMISSIONS ??
      process.env.GEMINI_MAX_OUTPUT_TOKENS_MINUTES ??
      65536,
  );

  let combinedText = "";
  let retryCount = 0;
  let finishReason: FinishReason | undefined;
  let truncated = false;
  const usageCalls: GeminiUsageCall[] = [];
  let userText = options.userText;

  for (let attempt = 0; attempt <= MAX_OMISSIONS_CONTINUATIONS; attempt++) {
    const generativeModel = client.getGenerativeModel({
      model: modelName,
      systemInstruction: options.systemInstruction,
      generationConfig: {
        ...buildGenerationConfig({
          modelName,
          maxOutputTokens,
          temperature: 0.2,
        }),
        responseMimeType: "application/json",
      },
    });

    const result = await generativeModel.generateContent([
      `USER INPUT\n\n${userText}`,
    ]);

    const parsed = parseGenerationResult(result.response, {
      modelName,
      step:
        attempt === 0 ? "omissions_analysis" : "omissions_analysis_continuation",
    });

    usageCalls.push(...parsed.usageCalls);
    finishReason = parsed.finishReason;
    truncated = parsed.truncated;

    if (attempt === 0) {
      combinedText = parsed.text;
    } else {
      combinedText = stitchContinuedJson(combinedText, parsed.text);
      retryCount = attempt;
    }

    if (!parsed.truncated) {
      break;
    }

    userText = `The previous JSON response was truncated because the output token limit was reached.

Continue the JSON object EXACTLY where the partial output ends. Do not repeat keys or content already written. Output only valid JSON (no markdown fences) that completes the document.

PARTIAL JSON SO FAR
<<<
${combinedText}
>>>`;
  }

  const usage = usageCalls.reduce(
    (acc, call) => ({
      inputTokens: acc.inputTokens + call.inputTokens,
      outputTokens: acc.outputTokens + call.outputTokens,
      totalTokens: acc.totalTokens + call.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );

  return {
    text: combinedText,
    finishReason,
    truncated,
    retryCount,
    modelName,
    usage,
    usageCalls,
  };
}

/** Merge meeting todos into the global board checklist. */
export async function generateGlobalTodosMerge(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
}): Promise<GeminiGenerationResult> {
  const client = new GoogleGenerativeAI(requireApiKey());
  const modelName =
    options.modelName?.trim() ||
    process.env.GEMINI_MODEL_TODOS?.trim() ||
    process.env.GEMINI_MODEL_OMISSIONS?.trim() ||
    DEFAULT_GEMINI_MODEL;

  const maxOutputTokens = Number(
    process.env.GEMINI_MAX_OUTPUT_TOKENS_TODOS ?? 16384,
  );

  const generativeModel = client.getGenerativeModel({
    model: modelName,
    systemInstruction: options.systemInstruction,
    generationConfig: {
      ...buildGenerationConfig({
        modelName,
        maxOutputTokens,
        temperature: 0.15,
      }),
      responseMimeType: "application/json",
    },
  });

  const result = await generativeModel.generateContent([
    `USER INPUT\n\n${options.userText}`,
  ]);

  return parseGenerationResult(result.response, {
    modelName,
    step: "global_todos_merge",
  });
}

export async function generateEmailExtraction(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
  maxOutputTokens?: number;
  fileParts?: Array<{ mimeType: string; data: Buffer; label?: string }>;
  step?: string;
}): Promise<GeminiGenerationResult> {
  const client = new GoogleGenerativeAI(requireApiKey());
  const modelName =
    options.modelName?.trim() ||
    process.env.GEMINI_MODEL_EMAIL_ANALYSIS?.trim() ||
    DEFAULT_GEMINI_MODEL;

  const maxOutputTokens =
    options.maxOutputTokens ??
    Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_EMAIL_ANALYSIS ?? 65536);

  const generativeModel = client.getGenerativeModel({
    model: modelName,
    systemInstruction: options.systemInstruction,
    generationConfig: {
      ...buildGenerationConfig({
        modelName,
        maxOutputTokens,
        temperature: 0.15,
      }),
      responseMimeType: "application/json",
    },
  });

  const parts: Array<
    string | { inlineData: { mimeType: string; data: string } }
  > = [`USER INPUT\n\n${options.userText}`];

  for (const file of options.fileParts ?? []) {
    parts.push({
      inlineData: {
        mimeType: file.mimeType,
        data: file.data.toString("base64"),
      },
    });
  }

  const result = await generativeModel.generateContent(parts);

  return parseGenerationResult(result.response, {
    modelName,
    step: options.step ?? "email_extraction",
  });
}

export async function generateEmailExtractionMerge(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
  maxOutputTokens?: number;
}): Promise<GeminiGenerationResult> {
  return generateEmailExtraction({
    ...options,
    step: "email_extraction_merge",
  });
}

export async function generateMinutesJsonWithContinuation(options: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
}): Promise<GeminiGenerationResult & { continuationCount: number }> {
  let combinedText = "";
  let continuationCount = 0;
  let finishReason: FinishReason | undefined;
  let truncated = false;
  const usageCalls: GeminiUsageCall[] = [];
  let modelName =
    options.modelName?.trim() ||
    process.env.GEMINI_MODEL_MINUTES?.trim() ||
    DEFAULT_GEMINI_MODEL;

  let userText = options.userText;

  for (let attempt = 0; attempt <= MAX_MINUTES_CONTINUATIONS; attempt++) {
    const result = await generateWithSystemPrompt({
      systemInstruction: options.systemInstruction,
      userText,
      modelName: options.modelName,
    });

    modelName = result.modelName;
    usageCalls.push(...result.usageCalls);
    finishReason = result.finishReason;
    truncated = result.truncated;

    if (attempt === 0) {
      combinedText = result.text;
    } else {
      combinedText = stitchContinuedJson(combinedText, result.text);
      continuationCount = attempt;
    }

    if (!result.truncated) {
      break;
    }

    userText = `The previous response was cut off because the output token limit was reached.

Continue the JSON object EXACTLY where the partial output ends. Do not repeat any keys or content already written. Output only the continuation inside a single \`\`\`json fenced code block (the continuation should complete the JSON so the full document parses).

PARTIAL OUTPUT SO FAR
<<<
${combinedText}
>>>`;
  }

  const usage = usageCalls.reduce(
    (acc, call) => ({
      inputTokens: acc.inputTokens + call.inputTokens,
      outputTokens: acc.outputTokens + call.outputTokens,
      totalTokens: acc.totalTokens + call.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );

  return {
    text: combinedText,
    finishReason,
    truncated,
    continuationCount,
    modelName,
    usage,
    usageCalls,
  };
}
