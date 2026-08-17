import {
  loadContactHighlightRuns,
  type ContactHighlightModelRun,
} from "@/lib/email-analysis/contact-highlight-persist";
import type { ContactHighlightModelId } from "@/lib/email-analysis/contact-highlight-models";
import {
  totalCostFromContactExtractRuns,
  type ContactExtractSummary,
  type ContactHighlightModelRunDisplay,
} from "@/lib/email-analysis/contact-highlight-run-display";

function toModelRunDisplay(
  run: ContactHighlightModelRun,
): ContactHighlightModelRunDisplay {
  return {
    usage: run.usage,
    stats: run.stats,
    secondPass: run.secondPass
      ? {
          usage: run.secondPass.usage,
          stats: run.secondPass.stats,
        }
      : null,
    thirdPass: run.thirdPass
      ? {
          usage: run.thirdPass.usage,
          stats: run.thirdPass.stats,
        }
      : null,
    fourthPass: run.fourthPass
      ? {
          usage: run.fourthPass.usage,
          stats: run.fourthPass.stats,
          error: run.fourthPass.error,
        }
      : null,
  };
}

export function contactExtractSummaryFromRuns(
  runs: Partial<Record<ContactHighlightModelId, ContactHighlightModelRun>>,
): ContactExtractSummary | null {
  const displayRuns: ContactExtractSummary["runs"] = {};
  let hasAny = false;

  for (const [modelId, run] of Object.entries(runs) as Array<
    [ContactHighlightModelId, ContactHighlightModelRun | undefined]
  >) {
    if (!run) continue;
    hasAny = true;
    displayRuns[modelId] = toModelRunDisplay(run);
  }

  if (!hasAny) return null;

  return {
    runs: displayRuns,
    totalCostUsd: totalCostFromContactExtractRuns(displayRuns),
  };
}

/**
 * Load contact-extraction summaries keyed by group id (thread id or message id).
 * Each group’s email id list is loaded independently so merge keys match the
 * thread-page extract set.
 */
export async function loadContactExtractSummariesForGroups(
  groups: Record<string, string[]>,
): Promise<Record<string, ContactExtractSummary>> {
  const entries = Object.entries(groups).filter(
    ([, emailIds]) => emailIds.length > 0,
  );
  if (entries.length === 0) return {};

  const results = await Promise.all(
    entries.map(async ([groupId, emailIds]) => {
      const runs = await loadContactHighlightRuns(emailIds);
      const summary = contactExtractSummaryFromRuns(runs);
      return [groupId, summary] as const;
    }),
  );

  const out: Record<string, ContactExtractSummary> = {};
  for (const [groupId, summary] of results) {
    if (summary) out[groupId] = summary;
  }
  return out;
}
