import {
  loadProjectHighlightRuns,
  type ProjectHighlightModelRun,
} from "@/lib/email-analysis/project-highlight-persist";
import type { ProjectHighlightModelId } from "@/lib/email-analysis/project-highlight-models";
import {
  totalCostFromProjectExtractRuns,
  type ProjectExtractSummary,
  type ProjectHighlightModelRunDisplay,
} from "@/lib/email-analysis/project-highlight-run-display";

function toModelRunDisplay(
  run: ProjectHighlightModelRun,
): ProjectHighlightModelRunDisplay {
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

export function projectExtractSummaryFromRuns(
  runs: Partial<Record<ProjectHighlightModelId, ProjectHighlightModelRun>>,
): ProjectExtractSummary | null {
  const displayRuns: ProjectExtractSummary["runs"] = {};
  let hasAny = false;

  for (const [modelId, run] of Object.entries(runs) as Array<
    [ProjectHighlightModelId, ProjectHighlightModelRun | undefined]
  >) {
    if (!run) continue;
    hasAny = true;
    displayRuns[modelId] = toModelRunDisplay(run);
  }

  if (!hasAny) return null;

  return {
    runs: displayRuns,
    totalCostUsd: totalCostFromProjectExtractRuns(displayRuns),
  };
}

/**
 * Load project-extraction summaries keyed by group id (thread id or message id).
 * Each group’s email id list is loaded independently so merge keys match the
 * extract set.
 */
export async function loadProjectExtractSummariesForGroups(
  groups: Record<string, string[]>,
): Promise<Record<string, ProjectExtractSummary>> {
  const entries = Object.entries(groups).filter(
    ([, emailIds]) => emailIds.length > 0,
  );
  if (entries.length === 0) return {};

  // Sequential: parallel per-thread loads exhaust Supabase session pool (15 conn).
  const out: Record<string, ProjectExtractSummary> = {};
  for (const [groupId, emailIds] of entries) {
    const runs = await loadProjectHighlightRuns(emailIds);
    const summary = projectExtractSummaryFromRuns(runs);
    if (summary) out[groupId] = summary;
  }
  return out;
}
