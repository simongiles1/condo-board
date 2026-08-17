import type { EventHighlightModelId } from "@/lib/email-analysis/event-highlight-models";
import {
  loadEventHighlightRuns,
  type EventHighlightModelRun,
} from "@/lib/email-analysis/event-highlight-persist";
import {
  eventExtractSummaryFromApiRuns,
  type EventExtractSummary,
} from "@/lib/email-analysis/event-highlight-run-display";

export function eventExtractSummaryFromRuns(
  runs: Partial<Record<EventHighlightModelId, EventHighlightModelRun>>,
): EventExtractSummary | null {
  return eventExtractSummaryFromApiRuns(runs);
}

/**
 * Load event-harvest summaries keyed by group id (thread id or message id).
 */
export async function loadEventExtractSummariesForGroups(
  groups: Record<string, string[]>,
): Promise<Record<string, EventExtractSummary>> {
  const entries = Object.entries(groups).filter(
    ([, emailIds]) => emailIds.length > 0,
  );
  if (entries.length === 0) return {};

  const results = await Promise.all(
    entries.map(async ([groupId, emailIds]) => {
      const runs = await loadEventHighlightRuns(emailIds);
      const summary = eventExtractSummaryFromRuns(runs);
      return [groupId, summary] as const;
    }),
  );

  const out: Record<string, EventExtractSummary> = {};
  for (const [groupId, summary] of results) {
    if (summary) out[groupId] = summary;
  }
  return out;
}
