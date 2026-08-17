/** Client-safe display shapes for org-extraction run summaries / tables. */

import {
  ORG_HIGHLIGHT_MODELS,
  type OrgHighlightModelId,
} from "@/lib/email-analysis/org-highlight-models";
import type { OrgHighlightType } from "@/lib/email-analysis/org-highlight-shared";

export type OrgHighlightUsageDisplay = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  modelName: string;
};

export type OrgHighlightTypeCounts = Record<OrgHighlightType, number>;

export type OrgHighlightPassRunDisplay = {
  usage: OrgHighlightUsageDisplay;
  stats: {
    extracted: number;
    skipped: number;
    failed: number;
    typeCounts: OrgHighlightTypeCounts;
  };
};

export type OrgFingerprintPassRunDisplay = {
  usage: OrgHighlightUsageDisplay;
  stats: {
    cardCount: number;
    emailsWithCards: number;
    skipped: number;
    failed: number;
  };
};

export type OrgFingerprintMergePassRunDisplay = {
  usage: OrgHighlightUsageDisplay;
  stats: {
    cardCount: number;
    inputCardCount: number;
  };
  error: string | null;
};

export type OrgHighlightModelRunDisplay = OrgHighlightPassRunDisplay & {
  secondPass: OrgHighlightPassRunDisplay | null;
  thirdPass: OrgFingerprintPassRunDisplay | null;
  fourthPass: OrgFingerprintMergePassRunDisplay | null;
};

export type OrgExtractSummary = {
  totalCostUsd: number;
  runs: Partial<Record<OrgHighlightModelId, OrgHighlightModelRunDisplay>>;
};

export function totalCostFromOrgExtractRuns(
  runs: Partial<Record<OrgHighlightModelId, OrgHighlightModelRunDisplay>>,
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

/** Map GET /api/analysis/extract-organizations `runs` payload into a list summary. */
export function orgExtractSummaryFromApiRuns(
  runs: Partial<Record<string, OrgHighlightModelRunDisplay | null | undefined>>,
): OrgExtractSummary | null {
  const displayRuns: OrgExtractSummary["runs"] = {};
  let hasAny = false;

  for (const [modelId, run] of Object.entries(runs)) {
    if (!run) continue;
    if (!(ORG_HIGHLIGHT_MODELS as readonly string[]).includes(modelId)) {
      continue;
    }
    hasAny = true;
    displayRuns[modelId as OrgHighlightModelId] = {
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
    totalCostUsd: totalCostFromOrgExtractRuns(displayRuns),
  };
}

/** Unique org cards (merge pass), else fingerprints, else named spans. */
export function orgExtractItemCount(summary: OrgExtractSummary): number {
  let best = 0;
  for (const run of Object.values(summary.runs)) {
    if (!run) continue;
    const merged = run.fourthPass;
    const count =
      merged && !merged.error
        ? merged.stats.cardCount
        : (run.thirdPass?.stats.cardCount ??
          run.secondPass?.stats.typeCounts.organization_name ??
          run.stats.typeCounts.organization_name);
    if (count > best) best = count;
  }
  return best;
}
