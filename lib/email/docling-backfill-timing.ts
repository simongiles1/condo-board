/**
 * Client-side rate / ETA helpers for Docling backfill runs (page units).
 * Live runs use the current stint; finished runs fall back to full active time
 * so Past runs still show average rate + corpus extrapolation.
 */

export type DoclingBackfillRunTimingSource = {
  status: "running" | "completed" | "failed" | "cancelled";
  completedPages: number;
  totalPages: number;
  corpusUncachedPages: number;
  stintStartedAt: string | null;
  completedPagesAtStintStart: number;
  activeElapsedMs: number;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type DoclingBackfillTimingSnapshot = {
  activeMs: number;
  stintMs: number;
  stintPages: number;
  isRunning: boolean;
};

export type DoclingBackfillRateEstimate = {
  pagesPerMinute: number;
  secondsPerPage: number;
  /** ETA for remaining pages in this run. */
  runEtaMs: number | null;
  /** ETA for remaining corpus uncached pages at this sample rate. */
  corpusEtaMs: number | null;
  /** Pages used for the rate sample (stint or full run). */
  samplePages: number;
  /** Milliseconds used for the rate sample. */
  sampleMs: number;
};

export function getDoclingBackfillTimingSnapshot(
  run: DoclingBackfillRunTimingSource,
  now = Date.now(),
): DoclingBackfillTimingSnapshot {
  const isRunning = run.status === "running";
  const stintStartMs = run.stintStartedAt
    ? Date.parse(run.stintStartedAt)
    : Number.NaN;
  const stintMs =
    isRunning && Number.isFinite(stintStartMs)
      ? Math.max(0, now - stintStartMs)
      : 0;
  const activeMs = run.activeElapsedMs + stintMs;
  const stintPages = Math.max(
    0,
    run.completedPages - run.completedPagesAtStintStart,
  );

  return { activeMs, stintMs, stintPages, isRunning };
}

function rateFromSample(params: {
  sampleMs: number;
  samplePages: number;
  totalPages: number;
  completedPages: number;
  corpusUncachedPages: number;
}): DoclingBackfillRateEstimate {
  const {
    sampleMs,
    samplePages,
    totalPages,
    completedPages,
    corpusUncachedPages,
  } = params;
  const runRemaining = Math.max(0, totalPages - completedPages);
  const corpusRemaining = Math.max(0, corpusUncachedPages - completedPages);

  if (samplePages <= 0 || sampleMs < 1000) {
    return {
      pagesPerMinute: 0,
      secondsPerPage: 0,
      runEtaMs: null,
      corpusEtaMs: null,
      samplePages,
      sampleMs,
    };
  }

  const pagesPerMs = samplePages / sampleMs;
  const pagesPerMinute = pagesPerMs * 60_000;
  const secondsPerPage = sampleMs / samplePages / 1000;

  return {
    pagesPerMinute,
    secondsPerPage,
    runEtaMs: runRemaining > 0 ? runRemaining / pagesPerMs : 0,
    corpusEtaMs: corpusRemaining > 0 ? corpusRemaining / pagesPerMs : 0,
    samplePages,
    sampleMs,
  };
}

/** Rate from an explicit stint sample (live panel). */
export function estimateDoclingBackfillRate(params: {
  stintMs: number;
  stintPages: number;
  totalPages: number;
  completedPages: number;
  corpusUncachedPages: number;
}): DoclingBackfillRateEstimate {
  return rateFromSample({
    sampleMs: params.stintMs,
    samplePages: params.stintPages,
    totalPages: params.totalPages,
    completedPages: params.completedPages,
    corpusUncachedPages: params.corpusUncachedPages,
  });
}

/**
 * Live runs always use the current stint (never mix lifetime pages into a
 * short resume). Finished runs use full active time so Past runs keep an
 * average rate + corpus ETA. Falls back to wall-clock started→finished when
 * activeElapsedMs was not recorded.
 */
export function estimateDoclingBackfillRateForRun(
  run: DoclingBackfillRunTimingSource,
  now = Date.now(),
): DoclingBackfillRateEstimate & { activeMs: number } {
  const snap = getDoclingBackfillTimingSnapshot(run, now);

  let activeMs = snap.activeMs;
  if (!snap.isRunning && activeMs < 1000 && run.startedAt) {
    const startMs = Date.parse(run.startedAt);
    const endMs = run.finishedAt ? Date.parse(run.finishedAt) : now;
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      activeMs = endMs - startMs;
    }
  }

  const rate = rateFromSample({
    sampleMs: snap.isRunning ? snap.stintMs : activeMs,
    samplePages: snap.isRunning ? snap.stintPages : run.completedPages,
    totalPages: run.totalPages,
    completedPages: run.completedPages,
    corpusUncachedPages: run.corpusUncachedPages,
  });

  return { ...rate, activeMs };
}

export function formatDoclingBackfillDuration(ms: number): string {
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

export function formatDoclingBackfillRate(pagesPerMinute: number): string {
  if (!Number.isFinite(pagesPerMinute) || pagesPerMinute <= 0) {
    return "—";
  }
  if (pagesPerMinute >= 10) {
    return `${pagesPerMinute.toFixed(1)} pages/min`;
  }
  return `${pagesPerMinute.toFixed(2)} pages/min`;
}

export function formatDoclingBackfillEta(etaMs: number | null): string {
  if (etaMs === null) return "—";
  if (etaMs <= 0) return "Done";
  if (etaMs < 60_000) return "< 1 min";
  return `~${formatDoclingBackfillDuration(etaMs)}`;
}
