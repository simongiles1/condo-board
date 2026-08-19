/** Client-safe display shapes for project-extraction run summaries / tables. */

import {
  PROJECT_HIGHLIGHT_MODELS,
  type ProjectHighlightModelId,
} from "@/lib/email-analysis/project-highlight-models";
import type { ProjectHighlightType } from "@/lib/email-analysis/project-highlight-shared";

export type ProjectHighlightUsageDisplay = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  modelName: string;
};

export type ProjectHighlightTypeCounts = Record<ProjectHighlightType, number>;

export type ProjectHighlightPassRunDisplay = {
  usage: ProjectHighlightUsageDisplay;
  stats: {
    extracted: number;
    skipped: number;
    failed: number;
    typeCounts: ProjectHighlightTypeCounts;
  };
};

export type ProjectFingerprintPassRunDisplay = {
  usage: ProjectHighlightUsageDisplay;
  stats: {
    cardCount: number;
    emailsWithCards: number;
    skipped: number;
    failed: number;
  };
};

export type ProjectFingerprintMergePassRunDisplay = {
  usage: ProjectHighlightUsageDisplay;
  stats: {
    cardCount: number;
    inputCardCount: number;
  };
  error: string | null;
};

export type ProjectHighlightModelRunDisplay = ProjectHighlightPassRunDisplay & {
  secondPass: ProjectHighlightPassRunDisplay | null;
  thirdPass: ProjectFingerprintPassRunDisplay | null;
  fourthPass: ProjectFingerprintMergePassRunDisplay | null;
};

export type ProjectExtractSummary = {
  totalCostUsd: number;
  runs: Partial<Record<ProjectHighlightModelId, ProjectHighlightModelRunDisplay>>;
};

export function totalCostFromProjectExtractRuns(
  runs: Partial<Record<ProjectHighlightModelId, ProjectHighlightModelRunDisplay>>,
): number {
  let total = 0;
  for (const run of Object.values(runs)) {
    if (!run) continue;
    total += run.usage.costUsd;
    if (run.secondPass) total += run.secondPass.usage.costUsd;
    if (run.thirdPass) total += run.thirdPass.usage.costUsd;
    if (run.fourthPass) total += run.fourthPass.usage.costUsd;
  }
  return total;
}

/** Map GET /api/analysis/extract-projects `runs` payload into a list summary. */
export function projectExtractSummaryFromApiRuns(
  runs: Partial<
    Record<string, ProjectHighlightModelRunDisplay | null | undefined>
  >,
): ProjectExtractSummary | null {
  const displayRuns: ProjectExtractSummary["runs"] = {};
  let hasAny = false;

  for (const [modelId, run] of Object.entries(runs)) {
    if (!run) continue;
    if (!(PROJECT_HIGHLIGHT_MODELS as readonly string[]).includes(modelId)) {
      continue;
    }
    hasAny = true;
    displayRuns[modelId as ProjectHighlightModelId] = {
      usage: run.usage,
      stats: run.stats,
      secondPass: run.secondPass
        ? { usage: run.secondPass.usage, stats: run.secondPass.stats }
        : null,
      thirdPass: run.thirdPass
        ? { usage: run.thirdPass.usage, stats: run.thirdPass.stats }
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

  if (!hasAny) return null;

  return {
    runs: displayRuns,
    totalCostUsd: totalCostFromProjectExtractRuns(displayRuns),
  };
}

/** Unique project cards (merge pass), else fingerprints, else named spans. */
export function projectExtractItemCount(summary: ProjectExtractSummary): number {
  let best = 0;
  for (const run of Object.values(summary.runs)) {
    if (!run) continue;
    const merged = run.fourthPass;
    const count =
      merged && !merged.error
        ? merged.stats.cardCount
        : (run.thirdPass?.stats.cardCount ??
          run.secondPass?.stats.typeCounts.project_name ??
          run.stats.typeCounts.project_name);
    if (count > best) best = count;
  }
  return best;
}
