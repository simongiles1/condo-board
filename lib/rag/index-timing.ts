import type { EmbedCostRollingSnapshot } from "@/lib/rag/embed-cost-live";
import type { CorpusIndexStatus, IndexSliceOptions } from "@/lib/rag/indexer";

export type CorpusIndexStint = {
  startedAtMs: number;
  docsProcessed: number;
  /** Actual billed embed cost accumulated from slice API usage. */
  costUsd: number;
  inputTokens: number;
  mode: NonNullable<IndexSliceOptions["mode"]>;
};

export type CorpusIndexTimingSnapshot = {
  activeMs: number;
  stintMs: number;
  stintDocs: number;
  isRunning: boolean;
};

export type CorpusIndexRateEstimate = {
  docsPerMinute: number;
  secondsPerDoc: number;
  /** Remaining work for the active indexer mode. */
  modeEtaMs: number | null;
  /** Remaining work across the full corpus (all source kinds). */
  corpusEtaMs: number | null;
};

export function corpusRemainingForMode(
  status: CorpusIndexStatus,
  mode: NonNullable<IndexSliceOptions["mode"]>,
): number {
  const remainingEmails = Math.max(0, status.totalEmails - status.indexedEmails);
  const remainingAttachments = Math.max(
    0,
    status.totalParsedAttachments - status.indexedAttachments,
  );
  const remainingVisionPages = Math.max(
    0,
    status.totalDoneVisionPages - status.indexedVisionPages,
  );

  switch (mode) {
    case "emails":
      return remainingEmails;
    case "attachments":
      return remainingAttachments;
    case "vision":
      return remainingVisionPages;
    default:
      return remainingEmails + remainingAttachments + remainingVisionPages;
  }
}

export function corpusRemainingTotal(status: CorpusIndexStatus): number {
  return corpusRemainingForMode(status, "all");
}

export function getCorpusIndexTimingSnapshot(
  stint: CorpusIndexStint,
  isRunning: boolean,
  now = Date.now(),
): CorpusIndexTimingSnapshot {
  const stintMs = Math.max(0, now - stint.startedAtMs);
  return {
    activeMs: stintMs,
    stintMs,
    stintDocs: stint.docsProcessed,
    isRunning,
  };
}

/** Rate and ETA from the current stint only — not lifetime totals. */
export function estimateCorpusIndexRate(params: {
  stintMs: number;
  stintDocs: number;
  remainingInMode: number;
  remainingCorpus: number;
}): CorpusIndexRateEstimate {
  const { stintMs, stintDocs, remainingInMode, remainingCorpus } = params;

  if (stintDocs <= 0 || stintMs < 1000) {
    return {
      docsPerMinute: 0,
      secondsPerDoc: 0,
      modeEtaMs: null,
      corpusEtaMs: null,
    };
  }

  const docsPerMs = stintDocs / stintMs;
  const docsPerMinute = docsPerMs * 60_000;
  const secondsPerDoc = stintMs / stintDocs / 1000;

  return {
    docsPerMinute,
    secondsPerDoc,
    modeEtaMs: remainingInMode > 0 ? remainingInMode / docsPerMs : 0,
    corpusEtaMs: remainingCorpus > 0 ? remainingCorpus / docsPerMs : 0,
  };
}

export function formatCorpusIndexDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatCorpusIndexRate(docsPerMinute: number): string {
  if (!Number.isFinite(docsPerMinute) || docsPerMinute <= 0) {
    return "—";
  }
  if (docsPerMinute >= 10) {
    return `${docsPerMinute.toFixed(1)} docs/min`;
  }
  return `${docsPerMinute.toFixed(2)} docs/min`;
}

export function formatCorpusIndexEta(etaMs: number | null): string {
  if (etaMs === null) return "—";
  if (etaMs <= 0) return "Done";
  if (etaMs < 60_000) return "< 1 min";
  return `~${formatCorpusIndexDuration(etaMs)}`;
}

export type CorpusEmbedCostRateEstimate = {
  /** Smoothed USD/min — prefers rolling API window, else stint average. */
  costPerMinute: number;
  modeCostEtaUsd: number | null;
  corpusCostEtaUsd: number | null;
};

/**
 * Live embed cost extrapolation — pairs doc ETA with a smoothed burn rate.
 * Rolling window comes from per-API-call usage recorded in memory on the server.
 */
export function estimateCorpusEmbedCostRate(params: {
  stintMs: number;
  stintCostUsd: number;
  docRate: CorpusIndexRateEstimate;
  liveRolling: EmbedCostRollingSnapshot | null;
}): CorpusEmbedCostRateEstimate {
  const { stintMs, stintCostUsd, docRate, liveRolling } = params;

  let costPerMinute = 0;
  if (
    liveRolling &&
    liveRolling.sampleCount > 0 &&
    liveRolling.costPerMinute > 0
  ) {
    costPerMinute = liveRolling.costPerMinute;
  } else if (stintMs >= 1000 && stintCostUsd > 0) {
    costPerMinute = stintCostUsd / (stintMs / 60_000);
  }

  if (costPerMinute <= 0) {
    return {
      costPerMinute: 0,
      modeCostEtaUsd: null,
      corpusCostEtaUsd: null,
    };
  }

  const costFromEta = (etaMs: number | null): number | null => {
    if (etaMs === null) return null;
    if (etaMs <= 0) return 0;
    return (etaMs / 60_000) * costPerMinute;
  };

  return {
    costPerMinute,
    modeCostEtaUsd: costFromEta(docRate.modeEtaMs),
    corpusCostEtaUsd: costFromEta(docRate.corpusEtaMs),
  };
}

export function formatEmbedCostPerMinute(costPerMinute: number): string {
  if (!Number.isFinite(costPerMinute) || costPerMinute <= 0) return "—";
  if (costPerMinute >= 0.01) {
    return `$${costPerMinute.toFixed(3)}/min`;
  }
  return `$${costPerMinute.toFixed(4)}/min`;
}

export function formatEmbedCostEta(costUsd: number | null): string {
  if (costUsd === null) return "—";
  if (costUsd <= 0) return "$0.000";
  if (costUsd < 0.001) return "< $0.001";
  if (costUsd < 0.01) return `~$${costUsd.toFixed(4)}`;
  return `~$${costUsd.toFixed(3)}`;
}

export function corpusIndexModeLabel(
  mode: NonNullable<IndexSliceOptions["mode"]>,
): string {
  switch (mode) {
    case "emails":
      return "emails";
    case "attachments":
      return "attachments";
    case "vision":
      return "vision pages";
    default:
      return "all sources";
  }
}
