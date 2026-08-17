/** Client-safe display shapes for to-do harvest run summaries. */

import {
  TODO_HIGHLIGHT_MODELS,
  type TodoHighlightModelId,
} from "@/lib/email-analysis/todo-highlight-models";
import type { TodoHighlightExtraction } from "@/lib/email-analysis/todo-highlight-shared";

export type TodoHighlightUsageDisplay = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  modelName: string;
};

export type TodoHighlightModelRunDisplay = {
  usage: TodoHighlightUsageDisplay;
  stats: {
    extracted: number;
    skipped: number;
    failed: number;
    itemCount: number;
  };
};

export type TodoExtractListItem = {
  assignee: string;
  task: string;
  deadline: string | null;
  emailId: string;
  sourceQuote: string | null;
};

export type TodoExtractSummary = {
  totalCostUsd: number;
  runs: Partial<Record<TodoHighlightModelId, TodoHighlightModelRunDisplay>>;
  todos: TodoExtractListItem[];
};

type TodoExtractRunWithExtractions = TodoHighlightModelRunDisplay & {
  extractions?: Record<string, TodoHighlightExtraction>;
};

export function flattenTodoHighlightExtraction(
  emailId: string,
  extraction: TodoHighlightExtraction,
): TodoExtractListItem[] {
  return extraction.action_items.map((item) => ({
    assignee: item.assignee.trim() || "Unassigned",
    task: item.task.trim(),
    deadline: item.deadline?.trim() || null,
    emailId,
    sourceQuote: item.source_quote?.trim() || null,
  }));
}

function todosFromExtractRuns(
  runs: Partial<
    Record<string, TodoExtractRunWithExtractions | null | undefined>
  >,
): TodoExtractListItem[] {
  const items: TodoExtractListItem[] = [];
  for (const run of Object.values(runs)) {
    if (!run?.extractions) continue;
    for (const [emailId, extraction] of Object.entries(run.extractions)) {
      items.push(...flattenTodoHighlightExtraction(emailId, extraction));
    }
  }
  return items;
}

export function todoExtractItemKey(
  item: TodoExtractListItem,
  index: number,
): string {
  return `${item.emailId}|${item.assignee}|${item.task}|${item.deadline ?? ""}|${index}`;
}

export function totalCostFromTodoExtractRuns(
  runs: Partial<Record<TodoHighlightModelId, TodoHighlightModelRunDisplay>>,
): number {
  let total = 0;
  for (const run of Object.values(runs)) {
    if (!run) continue;
    total += run.usage.costUsd;
  }
  return total;
}

/** Map GET /api/analysis/extract-todos `runs` payload into a list summary. */
export function todoExtractSummaryFromApiRuns(
  runs: Partial<
    Record<string, TodoExtractRunWithExtractions | null | undefined>
  >,
): TodoExtractSummary | null {
  const displayRuns: TodoExtractSummary["runs"] = {};
  let hasAny = false;

  for (const [modelId, run] of Object.entries(runs)) {
    if (!run) continue;
    if (!(TODO_HIGHLIGHT_MODELS as readonly string[]).includes(modelId)) {
      continue;
    }
    hasAny = true;
    displayRuns[modelId as TodoHighlightModelId] = {
      usage: run.usage,
      stats: run.stats,
    };
  }

  if (!hasAny) return null;

  return {
    runs: displayRuns,
    totalCostUsd: totalCostFromTodoExtractRuns(displayRuns),
    todos: todosFromExtractRuns(runs),
  };
}

export function todoExtractItemCount(summary: TodoExtractSummary): number {
  if (summary.todos.length > 0) return summary.todos.length;
  let best = 0;
  for (const run of Object.values(summary.runs)) {
    if (!run) continue;
    if (run.stats.itemCount > best) best = run.stats.itemCount;
  }
  return best;
}
