export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  isErrorResponse,
  requireSession,
} from "@/lib/auth/authorize";
import {
  emptyTodoHighlightExtraction,
  extractTodoHighlightsFromText,
  type TodoHighlightExtraction,
} from "@/lib/email-analysis/todo-highlight-extraction";
import {
  isTodoHighlightModel,
  resolveTodoHighlightModel,
  type TodoHighlightModelId,
} from "@/lib/email-analysis/todo-highlight-models";
import {
  deleteTodoHighlightExtractions,
  loadTodoHighlightRuns,
  persistTodoHarvestActionItems,
  saveTodoHighlightExtractions,
} from "@/lib/email-analysis/todo-highlight-persist";
import { estimateCostUsd } from "@/lib/gemini/usage";

type RequestItem = {
  emailId?: string;
  highlightedText?: string;
  subject?: string;
  fromAddress?: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  bodyText?: string;
};

type ResultItem = {
  emailId: string;
  extraction: TodoHighlightExtraction;
  skipped?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  modelName?: string;
};

const MAX_ITEMS = 40;
const CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function parseEmailIdsParam(value: string | null): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function aggregateUsage(
  results: Array<{
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    costUsd?: number;
    modelName?: string;
  }>,
  modelId: TodoHighlightModelId,
) {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let modelName: string = modelId;

  for (const result of results) {
    if (!result.usage) continue;
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    totalTokens += result.usage.totalTokens;
    costUsd += result.costUsd ?? estimateCostUsd(modelId, result.usage);
    if (result.modelName) modelName = result.modelName;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    modelName,
  };
}

function normalizeItems(items: RequestItem[]) {
  return items.map((item, index) => {
    const emailId =
      typeof item.emailId === "string" ? item.emailId.trim() : "";
    const highlightedText =
      typeof item.highlightedText === "string"
        ? item.highlightedText.trim()
        : "";
    const subject = typeof item.subject === "string" ? item.subject : "";
    const fromAddress =
      typeof item.fromAddress === "string" ? item.fromAddress.trim() : "";
    const toAddresses = asStringArray(item.toAddresses);
    const ccAddresses = asStringArray(item.ccAddresses);
    const bodyText =
      typeof item.bodyText === "string" ? item.bodyText.trim() : "";
    if (!emailId) {
      throw new Error(`items[${index}].emailId is required.`);
    }
    return {
      emailId,
      highlightedText,
      subject,
      fromAddress,
      toAddresses,
      ccAddresses,
      bodyText,
    };
  });
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { searchParams } = new URL(request.url);
  const emailIds = parseEmailIdsParam(searchParams.get("emailIds"));

  if (emailIds.length === 0) {
    return NextResponse.json(
      { error: "emailIds is required (comma-separated)." },
      { status: 400 },
    );
  }

  try {
    const runs = await loadTodoHighlightRuns(emailIds);
    return NextResponse.json({ runs });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load to-do extractions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json()) as {
      emailIds?: string[];
      model?: string;
    };
    const emailIds = Array.isArray(body.emailIds)
      ? body.emailIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    if (emailIds.length === 0) {
      return NextResponse.json(
        { error: "emailIds is required (non-empty array)." },
        { status: 400 },
      );
    }
    if (!body.model || !isTodoHighlightModel(body.model)) {
      return NextResponse.json(
        { error: "Unsupported to-do extraction model." },
        { status: 400 },
      );
    }

    await deleteTodoHighlightExtractions(
      emailIds,
      body.model as TodoHighlightModelId,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not delete to-do extractions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const body = (await request.json()) as {
      items?: RequestItem[];
      model?: string;
    };
    const items = Array.isArray(body.items) ? body.items : [];

    if (body.model != null && !isTodoHighlightModel(body.model)) {
      return NextResponse.json(
        { error: "Unsupported to-do extraction model." },
        { status: 400 },
      );
    }

    const modelId = resolveTodoHighlightModel(body.model);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "items is required (non-empty array)." },
        { status: 400 },
      );
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `At most ${MAX_ITEMS} items per request.` },
        { status: 400 },
      );
    }

    const normalized = normalizeItems(items);

    const results = await mapWithConcurrency(
      normalized,
      CONCURRENCY,
      async (item): Promise<ResultItem> => {
        if (!item.highlightedText) {
          return {
            emailId: item.emailId,
            extraction: emptyTodoHighlightExtraction(),
            skipped: true,
          };
        }

        try {
          const { extraction, usage, costUsd, modelName } =
            await extractTodoHighlightsFromText(
              {
                subject: item.subject,
                fromAddress: item.fromAddress,
                toAddresses: item.toAddresses,
                ccAddresses: item.ccAddresses,
                highlightedText: item.highlightedText,
              },
              modelId,
            );
          return {
            emailId: item.emailId,
            extraction,
            usage,
            costUsd,
            modelName,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Extraction failed.";
          return {
            emailId: item.emailId,
            extraction: emptyTodoHighlightExtraction(),
            error: message,
          };
        }
      },
    );

    await saveTodoHighlightExtractions(modelId, results);
    await persistTodoHarvestActionItems(modelId, results);

    return NextResponse.json({
      results,
      model: modelId,
      pass: 1,
      usage: aggregateUsage(results, modelId),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "To-do extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
