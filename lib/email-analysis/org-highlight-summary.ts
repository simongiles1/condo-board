import {
  loadOrgHighlightRuns,
  type OrgHighlightModelRun,
} from "@/lib/email-analysis/org-highlight-persist";
import type { OrgHighlightModelId } from "@/lib/email-analysis/org-highlight-models";
import {
  totalCostFromOrgExtractRuns,
  type OrgExtractSummary,
  type OrgHighlightModelRunDisplay,
} from "@/lib/email-analysis/org-highlight-run-display";

function toModelRunDisplay(
  run: OrgHighlightModelRun,
): OrgHighlightModelRunDisplay {
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

export function orgExtractSummaryFromRuns(
  runs: Partial<Record<OrgHighlightModelId, OrgHighlightModelRun>>,
): OrgExtractSummary | null {
  const displayRuns: OrgExtractSummary["runs"] = {};
  let hasAny = false;

  for (const [modelId, run] of Object.entries(runs) as Array<
    [OrgHighlightModelId, OrgHighlightModelRun | undefined]
  >) {
    if (!run) continue;
    hasAny = true;
    displayRuns[modelId] = toModelRunDisplay(run);
  }

  if (!hasAny) return null;

  return {
    runs: displayRuns,
    totalCostUsd: totalCostFromOrgExtractRuns(displayRuns),
  };
}

/**
 * Load org-extraction summaries keyed by group id (thread id or message id).
 * Each group’s email id list is loaded independently so merge keys match the
 * extract set.
 */
export async function loadOrgExtractSummariesForGroups(
  groups: Record<string, string[]>,
): Promise<Record<string, OrgExtractSummary>> {
  const entries = Object.entries(groups).filter(
    ([, emailIds]) => emailIds.length > 0,
  );
  if (entries.length === 0) return {};

  // Sequential: parallel per-thread loads exhaust Supabase session pool (15 conn).
  const out: Record<string, OrgExtractSummary> = {};
  for (const [groupId, emailIds] of entries) {
    const runs = await loadOrgHighlightRuns(emailIds);
    const summary = orgExtractSummaryFromRuns(runs);
    if (summary) out[groupId] = summary;
  }
  return out;
}
