import type { TodoHighlightModelId } from "@/lib/email-analysis/todo-highlight-models";
import {
  loadTodoHighlightRuns,
  type TodoHighlightModelRun,
} from "@/lib/email-analysis/todo-highlight-persist";
import {
  todoExtractSummaryFromApiRuns,
  type TodoExtractSummary,
} from "@/lib/email-analysis/todo-highlight-run-display";

export function todoExtractSummaryFromRuns(
  runs: Partial<Record<TodoHighlightModelId, TodoHighlightModelRun>>,
): TodoExtractSummary | null {
  return todoExtractSummaryFromApiRuns(runs);
}

/** Load to-do harvest summaries keyed by group id (thread id or message id). */
export async function loadTodoExtractSummariesForGroups(
  groups: Record<string, string[]>,
): Promise<Record<string, TodoExtractSummary>> {
  const entries = Object.entries(groups).filter(
    ([, emailIds]) => emailIds.length > 0,
  );
  if (entries.length === 0) return {};

  // Sequential: parallel per-thread loads exhaust Supabase session pool (15 conn).
  const out: Record<string, TodoExtractSummary> = {};
  for (const [groupId, emailIds] of entries) {
    const runs = await loadTodoHighlightRuns(emailIds);
    const summary = todoExtractSummaryFromRuns(runs);
    if (summary) out[groupId] = summary;
  }
  return out;
}
