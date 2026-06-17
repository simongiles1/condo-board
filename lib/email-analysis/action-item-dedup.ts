import { and, eq } from "drizzle-orm";

import {
  ACTION_ITEM_SEMANTIC_DEDUP_SYSTEM_PROMPT,
  buildActionItemSemanticDedupUserPrompt,
} from "@/lib/email-analysis/prompts";
import type { ActionItemExtraction } from "@/lib/email-analysis/schema";
import { getDb } from "@/lib/db";
import { extractedActionItems } from "@/lib/db/schema";
import { generateEmailExtraction } from "@/lib/gemini/client";
import { unwrapJsonCodeBlock } from "@/lib/gemini/parse-output";
import {
  estimateCostUsdForCalls,
  type GeminiUsageCall,
} from "@/lib/gemini/usage";

const DEDUP_MAX_OUTPUT_TOKENS = 4096;

export type SemanticActionItemDedupResult = {
  insertItems: ActionItemExtraction[];
  supersedeOpenIds: string[];
  calls: GeminiUsageCall[];
  costUsd: number;
};

type OpenActionItem = {
  id: string;
  assignee: string;
  description: string;
  deadline: string | null;
  createdAt: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseInsertItems(value: unknown): ActionItemExtraction[] {
  if (!Array.isArray(value)) return [];

  const items: ActionItemExtraction[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const assignee = asString(entry.assignee);
    const task = asString(entry.task);
    if (!assignee || !task) continue;

    items.push({
      assignee,
      task,
      deadline: asString(entry.deadline),
      source_quote: asString(entry.source_quote),
    });
  }

  return items;
}

export function parseSemanticActionItemDedupResult(raw: unknown): {
  insertItems: ActionItemExtraction[];
  supersedeOpenIds: string[];
} {
  if (!isObject(raw)) {
    return { insertItems: [], supersedeOpenIds: [] };
  }

  const insertItems = parseInsertItems(raw.insert_items);
  const supersedeOpenIds = Array.isArray(raw.supersede_open_ids)
    ? raw.supersede_open_ids
        .map((id) => asString(id))
        .filter((id): id is string => Boolean(id))
    : [];

  return { insertItems, supersedeOpenIds };
}

async function loadOpenThreadActionItems(
  threadId: string,
): Promise<OpenActionItem[]> {
  const db = getDb();
  return db
    .select({
      id: extractedActionItems.id,
      assignee: extractedActionItems.assignee,
      description: extractedActionItems.description,
      deadline: extractedActionItems.deadline,
      createdAt: extractedActionItems.createdAt,
    })
    .from(extractedActionItems)
    .where(
      and(
        eq(extractedActionItems.emailThreadId, threadId),
        eq(extractedActionItems.completed, false),
      ),
    );
}

async function markSupersededOpenItems(ids: string[]): Promise<number> {
  if (!ids.length) return 0;

  const db = getDb();
  const now = new Date().toISOString();
  let closed = 0;

  for (const id of ids) {
    const result = await db
      .update(extractedActionItems)
      .set({ completed: true, completedAt: now })
      .where(
        and(
          eq(extractedActionItems.id, id),
          eq(extractedActionItems.completed, false),
        ),
      );
    if (result.rowCount) closed += 1;
  }

  return closed;
}

/**
 * Semantic dedup before insert — compares incoming extraction items against
 * open thread tasks. Not string/fuzzy matching; uses Gemini obligation matching.
 */
export async function semanticDeduplicateIncomingActionItems(input: {
  threadId: string;
  newItems: ActionItemExtraction[];
  modelName: string;
}): Promise<SemanticActionItemDedupResult> {
  if (!input.newItems.length) {
    return { insertItems: [], supersedeOpenIds: [], calls: [], costUsd: 0 };
  }

  const openItems = await loadOpenThreadActionItems(input.threadId);
  if (input.newItems.length <= 1 && !openItems.length) {
    return {
      insertItems: input.newItems,
      supersedeOpenIds: [],
      calls: [],
      costUsd: 0,
    };
  }

  const generation = await generateEmailExtraction({
    systemInstruction: ACTION_ITEM_SEMANTIC_DEDUP_SYSTEM_PROMPT,
    userText: buildActionItemSemanticDedupUserPrompt({
      newItems: input.newItems,
      openItems: openItems.map((item) => ({
        id: item.id,
        assignee: item.assignee,
        task: item.description,
        deadline: item.deadline,
        created_at: item.createdAt,
      })),
    }),
    modelName: input.modelName,
    maxOutputTokens: DEDUP_MAX_OUTPUT_TOKENS,
    step: "action_item_semantic_dedup",
  });

  const { jsonText } = unwrapJsonCodeBlock(generation.text);
  const parsed = parseSemanticActionItemDedupResult(
    JSON.parse(jsonText) as unknown,
  );
  const openById = new Set(openItems.map((item) => item.id));
  const supersedeOpenIds = parsed.supersedeOpenIds.filter((id) =>
    openById.has(id),
  );

  if (supersedeOpenIds.length) {
    const closed = await markSupersededOpenItems(supersedeOpenIds);
    if (closed) {
      console.info("[email-analysis:action-item-dedup]", {
        threadId: input.threadId,
        incomingCount: input.newItems.length,
        insertCount: parsed.insertItems.length,
        supersededOpen: closed,
      });
    }
  }

  const calls = generation.usageCalls;
  const insertItems =
    parsed.insertItems.length > 0 ? parsed.insertItems : input.newItems;

  if (!parsed.insertItems.length && input.newItems.length > 1) {
    console.warn("[email-analysis:action-item-dedup]", {
      threadId: input.threadId,
      message:
        "Semantic dedup returned no insert_items; falling back to raw extraction batch.",
      incomingCount: input.newItems.length,
    });
  }

  return {
    insertItems,
    supersedeOpenIds,
    calls,
    costUsd: estimateCostUsdForCalls(calls),
  };
}
