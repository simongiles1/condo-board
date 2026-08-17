/** Client-safe display shapes for contact-extraction run summaries / tables. */

import {
  CONTACT_HIGHLIGHT_MODELS,
  type ContactHighlightModelId,
} from "@/lib/email-analysis/contact-highlight-models";
import type { ContactHighlightType } from "@/lib/email-analysis/contact-highlight-shared";

export type ContactHighlightUsageDisplay = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  modelName: string;
};

export type ContactHighlightTypeCounts = Record<ContactHighlightType, number>;

export type ContactHighlightPassRunDisplay = {
  usage: ContactHighlightUsageDisplay;
  stats: {
    extracted: number;
    skipped: number;
    failed: number;
    typeCounts: ContactHighlightTypeCounts;
  };
};

export type ContactFingerprintPassRunDisplay = {
  usage: ContactHighlightUsageDisplay;
  stats: {
    cardCount: number;
    emailsWithCards: number;
    skipped: number;
    failed: number;
  };
};

export type ContactFingerprintMergePassRunDisplay = {
  usage: ContactHighlightUsageDisplay;
  stats: {
    cardCount: number;
    inputCardCount: number;
  };
  error: string | null;
};

export type ContactHighlightModelRunDisplay = ContactHighlightPassRunDisplay & {
  secondPass: ContactHighlightPassRunDisplay | null;
  thirdPass: ContactFingerprintPassRunDisplay | null;
  fourthPass: ContactFingerprintMergePassRunDisplay | null;
};

export type ContactExtractSummary = {
  totalCostUsd: number;
  runs: Partial<Record<ContactHighlightModelId, ContactHighlightModelRunDisplay>>;
};

export function totalCostFromContactExtractRuns(
  runs: Partial<Record<ContactHighlightModelId, ContactHighlightModelRunDisplay>>,
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

/** Map GET /api/analysis/extract-contacts `runs` payload into a list summary. */
export function contactExtractSummaryFromApiRuns(
  runs: Partial<Record<string, ContactHighlightModelRunDisplay | null | undefined>>,
): ContactExtractSummary | null {
  const displayRuns: ContactExtractSummary["runs"] = {};
  let hasAny = false;

  for (const [modelId, run] of Object.entries(runs)) {
    if (!run) continue;
    if (
      !(CONTACT_HIGHLIGHT_MODELS as readonly string[]).includes(modelId)
    ) {
      continue;
    }
    hasAny = true;
    displayRuns[modelId as ContactHighlightModelId] = {
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
    totalCostUsd: totalCostFromContactExtractRuns(displayRuns),
  };
}

/** Unique contact cards (merge pass), else fingerprints, else named spans. */
export function contactExtractItemCount(
  summary: ContactExtractSummary,
): number {
  let best = 0;
  for (const run of Object.values(summary.runs)) {
    if (!run) continue;
    const merged = run.fourthPass;
    const count =
      merged && !merged.error
        ? merged.stats.cardCount
        : (run.thirdPass?.stats.cardCount ??
          run.secondPass?.stats.typeCounts.contact_name ??
          run.stats.typeCounts.contact_name);
    if (count > best) best = count;
  }
  return best;
}
