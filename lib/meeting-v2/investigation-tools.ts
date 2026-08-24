import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  meetingsV2AgendaItemContexts,
  meetingsV2DocumentChunks,
} from "@/lib/db/schema";
import {
  type AgendaItemContextDocument,
  type ChunkContext,
} from "@/lib/meeting-v2/evidence";

type ChunkMetadata = {
  aiChunkId?: string;
  chunkLabel?: string;
  prevAiChunkId?: string | null;
  nextAiChunkId?: string | null;
  pageNumbers?: number[];
  sequenceRange?: [number, number];
};

type DeepSeekToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
};

export type InvestigationToolRuntime = {
  meetingId: string;
  contextsByAgendaItemId: Map<
    string,
    {
      id: string;
      context: AgendaItemContextDocument;
      assembledContextText: string;
      createdAt: string;
      updatedAt: string;
    }
  >;
  chunksByAiId: Map<string, ChunkContext>;
  transcriptChunks: ChunkContext[];
};

export type InvestigationToolCallRecord = {
  turn: number;
  name: string;
  args: Record<string, unknown>;
  response: Record<string, unknown>;
};

export type ToolEnabledInvestigationResult = {
  text: string;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
  };
  estimatedCostUsd: number;
  requestTrace: {
    provider: "deepseek";
    model: string;
    systemInstruction: string;
    turns: Array<{
      turn: number;
      requestMessages: DeepSeekMessage[];
      receivedContent: string | null;
      functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    }>;
  };
  toolCalls: InvestigationToolCallRecord[];
};

function requireApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key?.trim()) {
    throw new Error("DEEPSEEK_API_KEY is missing. Copy .env.local.example to .env.local.");
  }
  return key.trim();
}

function deepSeekBaseUrl(): string {
  const configured = process.env.DEEPSEEK_API_BASE_URL?.trim();
  return (configured || "https://api.deepseek.com").replace(/\/$/, "");
}

function safeParseObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fallbackAiChunkId(chunk: typeof meetingsV2DocumentChunks.$inferSelect): string {
  return `${chunk.chunkKind === "document" ? "document_chunk" : "transcript_chunk"}_${String(
    chunk.sortOrder + 1,
  ).padStart(3, "0")}`;
}

function toChunkContext(
  chunk: typeof meetingsV2DocumentChunks.$inferSelect,
  metadata: ChunkMetadata | null,
): ChunkContext {
  const pageNumbers =
    metadata?.pageNumbers ??
    [chunk.pageStart, chunk.pageEnd].flatMap((entry) =>
      typeof entry === "number" && Number.isFinite(entry) ? [entry] : [],
    );

  return {
    chunkId: metadata?.aiChunkId ?? fallbackAiChunkId(chunk),
    chunkKind: chunk.chunkKind,
    chunkKey: chunk.chunkKey,
    chunkLabel: metadata?.chunkLabel ?? null,
    sortOrder: chunk.sortOrder,
    pageRange:
      pageNumbers.length > 0
        ? ([pageNumbers[0], pageNumbers[pageNumbers.length - 1]] as [number, number])
        : null,
    sequenceRange:
      metadata?.sequenceRange ??
      (typeof chunk.sequenceStart === "number" && typeof chunk.sequenceEnd === "number"
        ? ([chunk.sequenceStart, chunk.sequenceEnd] as [number, number])
        : null),
    startTimestamp: chunk.startTimestamp,
    endTimestamp: chunk.endTimestamp,
    text: chunk.text,
    neighbors: {
      previous: metadata?.prevAiChunkId ?? null,
      next: metadata?.nextAiChunkId ?? null,
    },
  };
}

function excerptAround(text: string, query: string, maxLength = 280): string {
  const normalizedText = normalizeWhitespace(text);
  const loweredText = normalizedText.toLowerCase();
  const loweredQuery = query.toLowerCase();
  const index = loweredText.indexOf(loweredQuery);
  if (index < 0) return normalizedText.slice(0, maxLength);
  const start = Math.max(0, index - 90);
  const end = Math.min(normalizedText.length, index + maxLength - 90);
  return normalizedText.slice(start, end);
}

function tokenizeQuery(query: string): string[] {
  return normalizeWhitespace(query)
    .toLowerCase()
    .split(/[^a-z0-9$]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

const DECISION_LANGUAGE_PATTERNS = [
  "board decision",
  "move ahead",
  "moving ahead",
  "motion",
  "motion carried",
  "approved",
  "approval",
  "conditional approval",
  "ratified",
  "ratification",
  "agreed",
  "we agreed",
  "we should go with",
  "go with the",
  "next please",
  "the minutes should read",
  "subject to",
];

const TOPIC_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "item",
  "items",
  "board",
  "meeting",
  "system",
  "project",
  "approval",
  "discussion",
  "report",
]);

function normalizeForMatch(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function tokenizeTopicTerms(value: string): string[] {
  return normalizeForMatch(value)
    .split(/[^a-z0-9$]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !TOPIC_STOPWORDS.has(token));
}

function buildAgendaItemResolutionTerms(context: AgendaItemContextDocument): {
  phrases: string[];
  tokens: string[];
} {
  const phrases = [context.title, ...context.aliases, ...context.notes]
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);
  const tokenSet = new Set<string>();
  for (const phrase of phrases) {
    for (const token of tokenizeTopicTerms(phrase)) {
      tokenSet.add(token);
    }
  }
  return {
    phrases: [...new Set(phrases)],
    tokens: [...tokenSet],
  };
}

function scoreLaterResolutionCandidate(options: {
  chunk: ChunkContext;
  lastAnchorSortOrder: number;
  topicPhrases: string[];
  topicTokens: string[];
}) {
  const text = normalizeForMatch(options.chunk.text);
  const matchedTopicPhrases = options.topicPhrases.filter((phrase) => {
    const normalized = normalizeForMatch(phrase);
    return normalized.length >= 3 && text.includes(normalized);
  });
  const matchedTopicTokens = options.topicTokens.filter((token) => text.includes(token));
  const matchedDecisionPhrases = DECISION_LANGUAGE_PATTERNS.filter((phrase) => text.includes(phrase));
  const topicScore = matchedTopicPhrases.length * 6 + matchedTopicTokens.length * 2;
  const decisionScore = matchedDecisionPhrases.length * 5;
  const distanceFromLastAnchor = Math.max(0, options.chunk.sortOrder - options.lastAnchorSortOrder);
  const proximityBonus = Math.max(0, 8 - Math.min(distanceFromLastAnchor, 8));

  return {
    topicScore,
    decisionScore,
    matchedTopicPhrases,
    matchedTopicTokens,
    matchedDecisionPhrases,
    distanceFromLastAnchor,
    totalScore: topicScore + decisionScore + proximityBonus,
  };
}

function cloneMessages(messages: DeepSeekMessage[]): DeepSeekMessage[] {
  return JSON.parse(JSON.stringify(messages)) as DeepSeekMessage[];
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractJsonObjectText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    const fenced = fencedMatch[1].trim();
    try {
      JSON.parse(fenced);
      return fenced;
    } catch {
      // Fall through.
    }
  }

  const startsAt = trimmed.indexOf("{");
  if (startsAt < 0) return null;

  for (let start = startsAt; start < trimmed.length; start += 1) {
    if (trimmed[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (char === "\\") {
          isEscaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = trimmed.slice(start, index + 1).trim();
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

function getInvestigationToolDefinitions(): DeepSeekToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "get_context_bundle",
        description: "Get the stored prepared context bundle for one agenda item in the current meeting.",
        parameters: {
          type: "object",
          properties: {
            agendaItemId: { type: "string", description: "The agenda item id." },
          },
          required: ["agendaItemId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_chunk",
        description: "Fetch one chunk by its AI-facing chunk id, including full text and neighbor ids.",
        parameters: {
          type: "object",
          properties: {
            chunkId: { type: "string", description: "AI-facing chunk id like document_chunk_012." },
          },
          required: ["chunkId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_neighbor_chunk",
        description: "Fetch the previous or next neighbor chunk for a given chunk id.",
        parameters: {
          type: "object",
          properties: {
            chunkId: { type: "string", description: "AI-facing chunk id." },
            direction: { type: "string", enum: ["previous", "next"], description: "Which neighbor to fetch." },
          },
          required: ["chunkId", "direction"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_chunks_by_ids",
        description: "Fetch multiple chunks by their AI-facing chunk ids.",
        parameters: {
          type: "object",
          properties: {
            chunkIds: {
              type: "array",
              items: { type: "string", description: "One AI-facing chunk id." },
              description: "List of AI-facing chunk ids.",
            },
          },
          required: ["chunkIds"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_meeting_chunks",
        description: "Search the current meeting's stored chunks by keyword. Returns lightweight matches and excerpts, not full chunk text.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Keyword or short phrase to search." },
            chunkKind: { type: "string", enum: ["any", "document", "transcript"], description: "Optional chunk kind filter." },
            limit: { type: "integer", description: "Maximum number of matches to return." },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_later_resolution_for_item",
        description: "Find later transcript chunks in the same meeting where this agenda item appears to be resolved, approved, deferred, or otherwise concluded.",
        parameters: {
          type: "object",
          properties: {
            agendaItemId: { type: "string", description: "The agenda item id to follow later in the meeting." },
            limit: { type: "integer", description: "Maximum number of later transcript chunks to return." },
          },
          required: ["agendaItemId"],
          additionalProperties: false,
        },
      },
    },
  ];
}

export async function loadInvestigationToolRuntime(options: {
  meetingId: string;
}): Promise<InvestigationToolRuntime> {
  const db = getDb();
  const [chunkRows, contextRows] = await Promise.all([
    db
      .select()
      .from(meetingsV2DocumentChunks)
      .where(eq(meetingsV2DocumentChunks.meetingV2Id, options.meetingId)),
    db
      .select()
      .from(meetingsV2AgendaItemContexts)
      .where(eq(meetingsV2AgendaItemContexts.meetingV2Id, options.meetingId)),
  ]);

  const chunksByAiId = new Map<string, ChunkContext>();
  const transcriptChunks: ChunkContext[] = [];
  for (const row of chunkRows) {
    const metadata = safeParseObject<ChunkMetadata>(row.metadataJson);
    const context = toChunkContext(row, metadata);
    chunksByAiId.set(context.chunkId, context);
    if (context.chunkKind === "transcript") transcriptChunks.push(context);
  }

  const contextsByAgendaItemId = new Map<
    string,
    {
      id: string;
      context: AgendaItemContextDocument;
      assembledContextText: string;
      createdAt: string;
      updatedAt: string;
    }
  >();
  for (const row of contextRows) {
    const context = safeParseObject<AgendaItemContextDocument>(row.contextJson);
    if (!context) continue;
    contextsByAgendaItemId.set(row.agendaItemId, {
      id: row.id,
      context,
      assembledContextText: row.assembledContextText,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  return {
    meetingId: options.meetingId,
    contextsByAgendaItemId,
    chunksByAiId,
    transcriptChunks: transcriptChunks.sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

function serializeChunk(chunk: ChunkContext): Record<string, unknown> {
  return {
    chunkId: chunk.chunkId,
    chunkKind: chunk.chunkKind,
    chunkKey: chunk.chunkKey,
    chunkLabel: chunk.chunkLabel,
    pageRange: chunk.pageRange,
    sequenceRange: chunk.sequenceRange,
    startTimestamp: chunk.startTimestamp,
    endTimestamp: chunk.endTimestamp,
    neighbors: chunk.neighbors,
    text: chunk.text,
  };
}

export async function executeInvestigationTool(
  runtime: InvestigationToolRuntime,
  name: string,
  rawArgs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (name === "get_context_bundle") {
    const agendaItemId = typeof rawArgs.agendaItemId === "string" ? rawArgs.agendaItemId : "";
    const context = runtime.contextsByAgendaItemId.get(agendaItemId);
    return context
      ? {
          found: true,
          agendaItemId,
          context: context.context,
          assembledContextText: context.assembledContextText,
        }
      : { found: false, agendaItemId };
  }

  if (name === "get_chunk") {
    const chunkId = typeof rawArgs.chunkId === "string" ? rawArgs.chunkId : "";
    const chunk = runtime.chunksByAiId.get(chunkId);
    return chunk ? { found: true, chunk: serializeChunk(chunk) } : { found: false, chunkId };
  }

  if (name === "get_neighbor_chunk") {
    const chunkId = typeof rawArgs.chunkId === "string" ? rawArgs.chunkId : "";
    const direction = rawArgs.direction === "previous" ? "previous" : "next";
    const chunk = runtime.chunksByAiId.get(chunkId);
    const neighborId = chunk?.neighbors[direction] ?? null;
    const neighbor = neighborId ? runtime.chunksByAiId.get(neighborId) ?? null : null;
    return {
      found: Boolean(neighbor),
      chunkId,
      direction,
      neighborId,
      neighbor: neighbor ? serializeChunk(neighbor) : null,
    };
  }

  if (name === "get_chunks_by_ids") {
    const chunkIds = Array.isArray(rawArgs.chunkIds)
      ? rawArgs.chunkIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    return {
      foundCount: chunkIds.filter((chunkId) => runtime.chunksByAiId.has(chunkId)).length,
      chunks: chunkIds.flatMap((chunkId) => {
        const chunk = runtime.chunksByAiId.get(chunkId);
        return chunk ? [serializeChunk(chunk)] : [];
      }),
    };
  }

  if (name === "search_meeting_chunks") {
    const query = typeof rawArgs.query === "string" ? normalizeWhitespace(rawArgs.query) : "";
    const chunkKind =
      rawArgs.chunkKind === "document" || rawArgs.chunkKind === "transcript" ? rawArgs.chunkKind : "any";
    const limit =
      typeof rawArgs.limit === "number" && Number.isFinite(rawArgs.limit)
        ? Math.max(1, Math.min(8, Math.trunc(rawArgs.limit)))
        : 5;
    const tokens = tokenizeQuery(query);

    const matches = [...runtime.chunksByAiId.values()]
      .filter((chunk) => chunkKind === "any" || chunk.chunkKind === chunkKind)
      .map((chunk) => {
        const lowered = chunk.text.toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (lowered.includes(token)) score += token.length >= 6 ? 4 : 2;
        }
        return { chunk, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.chunk.sortOrder - right.chunk.sortOrder)
      .slice(0, limit)
      .map((entry) => ({
        chunkId: entry.chunk.chunkId,
        chunkKind: entry.chunk.chunkKind,
        chunkLabel: entry.chunk.chunkLabel,
        pageRange: entry.chunk.pageRange,
        sequenceRange: entry.chunk.sequenceRange,
        score: entry.score,
        excerpt: excerptAround(entry.chunk.text, query),
      }));

    return { query, chunkKind, count: matches.length, matches };
  }

  if (name === "find_later_resolution_for_item") {
    const agendaItemId = typeof rawArgs.agendaItemId === "string" ? rawArgs.agendaItemId : "";
    const limit =
      typeof rawArgs.limit === "number" && Number.isFinite(rawArgs.limit)
        ? Math.max(1, Math.min(8, Math.trunc(rawArgs.limit)))
        : 5;
    const storedContext = runtime.contextsByAgendaItemId.get(agendaItemId);
    if (!storedContext) {
      return { found: false, agendaItemId, reason: "No stored agenda item context found." };
    }

    const transcriptAnchorChunks = storedContext.context.anchorChunkIds
      .map((chunkId) => runtime.chunksByAiId.get(chunkId) ?? null)
      .filter((chunk): chunk is ChunkContext => chunk !== null && chunk.chunkKind === "transcript")
      .sort((left, right) => left.sortOrder - right.sortOrder);

    if (transcriptAnchorChunks.length === 0) {
      return { found: false, agendaItemId, reason: "No transcript anchors found for this agenda item." };
    }

    const lastAnchor = transcriptAnchorChunks[transcriptAnchorChunks.length - 1];
    const { phrases, tokens } = buildAgendaItemResolutionTerms(storedContext.context);
    const matches = runtime.transcriptChunks
      .filter((chunk) => chunk.sortOrder > lastAnchor.sortOrder)
      .map((chunk) => ({
        chunk,
        score: scoreLaterResolutionCandidate({
          chunk,
          lastAnchorSortOrder: lastAnchor.sortOrder,
          topicPhrases: phrases,
          topicTokens: tokens,
        }),
      }))
      .filter(({ score }) => score.topicScore > 0 && score.decisionScore > 0)
      .sort(
        (left, right) =>
          right.score.totalScore - left.score.totalScore ||
          left.score.distanceFromLastAnchor - right.score.distanceFromLastAnchor,
      )
      .slice(0, limit)
      .map(({ chunk, score }) => ({
        chunk: serializeChunk(chunk),
        distanceFromLastAnchor: score.distanceFromLastAnchor,
        matchedTopicPhrases: score.matchedTopicPhrases,
        matchedTopicTokens: score.matchedTopicTokens,
        matchedDecisionPhrases: score.matchedDecisionPhrases,
        score: score.totalScore,
      }));

    return {
      found: matches.length > 0,
      agendaItemId,
      title: storedContext.context.title,
      lastAnchorChunkId: lastAnchor.chunkId,
      transcriptAnchorChunkIds: transcriptAnchorChunks.map((chunk) => chunk.chunkId),
      searchedLaterTranscriptChunkCount: runtime.transcriptChunks.filter(
        (chunk) => chunk.sortOrder > lastAnchor.sortOrder,
      ).length,
      matchingResolutionChunkCount: matches.length,
      matches,
    };
  }

  throw new Error(`Unknown investigation tool: ${name}`);
}

async function createDeepSeekToolCompletion(options: {
  modelName: string;
  messages: DeepSeekMessage[];
  tools?: DeepSeekToolDefinition[];
  maxTokens: number;
  temperature: number;
  thinkingType?: "enabled" | "disabled";
  reasoningEffort?: "low" | "high" | "max";
}) {
  const response = await fetch(`${deepSeekBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireApiKey()}`,
    },
    body: JSON.stringify({
      model: options.modelName,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      thinking: { type: options.thinkingType ?? "disabled" },
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      messages: options.messages,
      ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    model?: string;
    choices?: Array<{
      message?: {
        role?: "assistant";
        content?: string | null;
        tool_calls?: DeepSeekToolCall[];
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_cache_miss_tokens?: number;
    };
  };

  const message = payload.choices?.[0]?.message;
  if (!message) {
    throw new Error("DeepSeek returned no assistant message.");
  }

  return {
    modelName: payload.model ?? options.modelName,
    message: {
      role: "assistant" as const,
      content: typeof message.content === "string" ? message.content : null,
      tool_calls: message.tool_calls,
    },
    usage: {
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens ?? 0,
      cacheHitTokens: payload.usage?.prompt_cache_hit_tokens ?? 0,
      cacheMissTokens: payload.usage?.prompt_cache_miss_tokens ?? 0,
    },
  };
}

export async function runToolEnabledInvestigation(options: {
  modelName?: string;
  systemInstruction: string;
  userText: string;
  runtime: InvestigationToolRuntime;
  maxOutputTokens?: number;
  maxToolRounds?: number;
}): Promise<ToolEnabledInvestigationResult> {
  const modelName = options.modelName?.trim() || "deepseek-v4-flash";
  const maxOutputTokens = options.maxOutputTokens ?? 4096;
  const maxToolRounds = options.maxToolRounds ?? 4;
  const tools = getInvestigationToolDefinitions();
  const messages: DeepSeekMessage[] = [
    { role: "system", content: options.systemInstruction },
    { role: "user", content: options.userText },
  ];

  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
  };
  const requestTrace: ToolEnabledInvestigationResult["requestTrace"] = {
    provider: "deepseek",
    model: modelName,
    systemInstruction: options.systemInstruction,
    turns: [],
  };
  const toolCalls: InvestigationToolCallRecord[] = [];

  for (let turn = 0; turn <= maxToolRounds; turn += 1) {
    const completion = await createDeepSeekToolCompletion({
      modelName,
      messages,
      tools,
      maxTokens: maxOutputTokens,
      temperature: 0.1,
      thinkingType: "disabled",
      reasoningEffort: "low",
    });

    usage.inputTokens += completion.usage.inputTokens;
    usage.outputTokens += completion.usage.outputTokens;
    usage.totalTokens += completion.usage.totalTokens;
    usage.cacheHitTokens += completion.usage.cacheHitTokens;
    usage.cacheMissTokens += completion.usage.cacheMissTokens;

    const functionCalls = (completion.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      args: parseToolArguments(call.function.arguments),
    }));

    requestTrace.turns.push({
      turn,
      requestMessages: cloneMessages(messages),
      receivedContent: completion.message.content,
      functionCalls,
    });

    messages.push(completion.message);

    if (functionCalls.length === 0) {
      const finalText = completion.message.content?.trim() ?? "";
      if (!finalText) throw new Error("DeepSeek investigation returned no final content.");
      return {
        text: extractJsonObjectText(finalText) ?? finalText,
        modelName: completion.modelName,
        usage,
        estimatedCostUsd: 0,
        requestTrace,
        toolCalls,
      };
    }

    for (const functionCall of functionCalls) {
      const response = await executeInvestigationTool(options.runtime, functionCall.name, functionCall.args);
      toolCalls.push({
        turn,
        name: functionCall.name,
        args: functionCall.args,
        response,
      });
      messages.push({
        role: "tool",
        tool_call_id: functionCall.id,
        content: JSON.stringify(response),
      });
    }
  }

  messages.push({
    role: "user",
    content:
      "Stop using tools. Based on the evidence already gathered in this conversation, return the final investigation JSON now. If evidence is incomplete, reflect that in confidence and open_questions, but still return the final JSON object only.",
  });

  const finalCompletion = await createDeepSeekToolCompletion({
    modelName,
    messages,
    maxTokens: maxOutputTokens,
    temperature: 0.1,
    thinkingType: "disabled",
    reasoningEffort: "low",
  });

  usage.inputTokens += finalCompletion.usage.inputTokens;
  usage.outputTokens += finalCompletion.usage.outputTokens;
  usage.totalTokens += finalCompletion.usage.totalTokens;
  usage.cacheHitTokens += finalCompletion.usage.cacheHitTokens;
  usage.cacheMissTokens += finalCompletion.usage.cacheMissTokens;

  requestTrace.turns.push({
    turn: maxToolRounds + 1,
    requestMessages: cloneMessages(messages),
    receivedContent: finalCompletion.message.content,
    functionCalls: [],
  });

  const finalText = finalCompletion.message.content?.trim() ?? "";
  if (!finalText) {
    throw new Error(
      "DeepSeek investigation tool loop exceeded the maximum number of tool rounds and the forced final response was empty.",
    );
  }

  return {
    text: extractJsonObjectText(finalText) ?? finalText,
    modelName: finalCompletion.modelName,
    usage,
    estimatedCostUsd: 0,
    requestTrace,
    toolCalls,
  };
}
