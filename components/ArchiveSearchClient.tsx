"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { formatDateTime } from "@/lib/format/datetime";
import { formatCostUsd, formatTokenCount } from "@/lib/gemini/usage";
import type { CorpusEmbeddingCostSummary } from "@/lib/rag/cost";
import type { EmbedCostRollingSnapshot } from "@/lib/rag/embed-cost-live";
import type { CorpusIndexStatus, IndexSliceResult } from "@/lib/rag/indexer";
import {
  corpusIndexModeLabel,
  corpusRemainingForMode,
  corpusRemainingTotal,
  estimateCorpusEmbedCostRate,
  estimateCorpusIndexRate,
  formatCorpusIndexDuration,
  formatCorpusIndexEta,
  formatCorpusIndexRate,
  formatEmbedCostEta,
  formatEmbedCostPerMinute,
  getCorpusIndexTimingSnapshot,
  type CorpusIndexStint,
} from "@/lib/rag/index-timing";
import type { CorpusSearchResult, CorpusSearchUsage } from "@/lib/rag/search";

const EXAMPLE_QUERIES = [
  "reserve fund study",
  "elevator modernization",
  "water leak repair",
  "annual general meeting minutes",
  "hvac chiller cooling tower",
  "window replacement warranty",
];

export function ArchiveSearchClient() {
  // Index Status State
  const [indexStatus, setIndexStatus] = useState<CorpusIndexStatus | null>(null);
  const [indexCosts, setIndexCosts] = useState<CorpusEmbeddingCostSummary | null>(null);
  const [liveEmbedCost, setLiveEmbedCost] = useState<EmbedCostRollingSnapshot | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [indexerRunning, setIndexerRunning] = useState(false);
  const [continuousIndexing, setContinuousIndexing] = useState(false);
  const [indexerBatchSize, setIndexerBatchSize] = useState<number>(25);
  const [indexerMode, setIndexerMode] = useState<"all" | "emails" | "attachments" | "vision">("all");
  const [indexerMessage, setIndexerMessage] = useState<string | null>(null);
  const [indexerError, setIndexerError] = useState<string | null>(null);
  const [sessionIndexCostUsd, setSessionIndexCostUsd] = useState(0);
  const [sessionSearchCostUsd, setSessionSearchCostUsd] = useState(0);
  const [indexStint, setIndexStint] = useState<CorpusIndexStint | null>(null);
  const [timingTick, setTimingTick] = useState(0);

  // Search State
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [searching, setSearching] = useState(false);
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<CorpusSearchResult[] | null>(null);
  const [lastSearchUsage, setLastSearchUsage] = useState<CorpusSearchUsage | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedChunkIds, setExpandedChunkIds] = useState<Set<string>>(new Set());

  // Ref to cancel continuous indexing if user unchecks or unmounts
  const continuousRef = useRef(false);
  continuousRef.current = continuousIndexing;
  const priorRemainingRef = useRef<{
    emails: number;
    attachments: number;
    visionPages: number;
  } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/corpus-index");
      const data = await res.json();
      if (res.ok && data.status) {
        setIndexStatus(data.status);
      }
      if (res.ok && data.costs) {
        setIndexCosts(data.costs);
      }
      if (res.ok && data.liveEmbedCost) {
        setLiveEmbedCost(data.liveEmbedCost);
      }
    } catch {
      // Non-fatal
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!indexerRunning) return;
    const timer = window.setInterval(() => {
      setTimingTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [indexerRunning]);

  const beginIndexStint = useCallback(
    (mode: typeof indexerMode) => {
      setIndexStint({
        startedAtMs: Date.now(),
        docsProcessed: 0,
        costUsd: 0,
        inputTokens: 0,
        mode,
      });
    },
    [],
  );

  const recordIndexSlice = useCallback((processed: number, costUsd: number, inputTokens: number) => {
    setIndexStint((prev) =>
      prev
        ? {
            ...prev,
            docsProcessed: prev.docsProcessed + processed,
            costUsd: prev.costUsd + costUsd,
            inputTokens: prev.inputTokens + inputTokens,
          }
        : null,
    );
  }, []);

  // Indexer execution
  const runIndexerSlice = useCallback(
    async (options?: {
      continuous?: boolean;
      priorRemaining?: {
        emails: number;
        attachments: number;
        visionPages: number;
      };
    }): Promise<boolean> => {
      setIndexerRunning(true);
      setIndexerError(null);
      try {
        const res = await fetch("/api/analysis/corpus-index", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchSize: indexerBatchSize,
            mode: indexerMode,
            refreshDashboard: !options?.continuous,
            priorRemaining: options?.priorRemaining,
          }),
        });

        const data = (await res.json()) as {
          result?: IndexSliceResult;
          status?: CorpusIndexStatus;
          costs?: CorpusEmbeddingCostSummary;
          liveEmbedCost?: EmbedCostRollingSnapshot;
          error?: string;
        };

        if (!res.ok || data.error) {
          throw new Error(data.error ?? "Indexing slice failed");
        }

        if (data.status) {
          setIndexStatus(data.status);
        } else if (data.result) {
          setIndexStatus((prev) => {
            if (!prev) return prev;
            const r = data.result!;
            return {
              ...prev,
              indexedEmails: prev.indexedEmails + r.emailsProcessed,
              indexedAttachments: prev.indexedAttachments + r.attachmentsProcessed,
              indexedVisionPages: prev.indexedVisionPages + r.visionPagesProcessed,
              totalChunks: prev.totalChunks + r.chunksCreated,
              lastIndexedAt:
                r.chunksCreated > 0 ? new Date().toISOString() : prev.lastIndexedAt,
            };
          });
        }
        if (data.costs) {
          setIndexCosts(data.costs);
        }
        if (data.liveEmbedCost) {
          setLiveEmbedCost(data.liveEmbedCost);
        }

        const r = data.result;
        if (r) {
          if (r.costUsd > 0) {
            setSessionIndexCostUsd((prev) => prev + r.costUsd);
          }
          const processed =
            r.emailsProcessed + r.attachmentsProcessed + r.visionPagesProcessed;
          recordIndexSlice(processed, r.costUsd, r.inputTokens);
          const costLabel = formatCostUsd(r.costUsd);
          const tokenLabel = formatTokenCount(r.inputTokens);
          const sourceLabel =
            r.tokenSource === "api" ? "billed tokens" : "estimated tokens";
          const msg = `Slice finished: ${processed} docs indexed (${r.chunksCreated} chunks, ${r.embeddingsComputed} embedded, ${r.embeddingsReused} reused) · ${tokenLabel} ${sourceLabel} · ${costLabel}. Remaining: ${r.remainingEmails} emails, ${r.remainingAttachments} attachments.`;
          setIndexerMessage(msg);

          priorRemainingRef.current = {
            emails: r.remainingEmails,
            attachments: r.remainingAttachments,
            visionPages: r.remainingVisionPages,
          };

          const hasMore =
            r.remainingEmails > 0 ||
            r.remainingAttachments > 0 ||
            r.remainingVisionPages > 0;

          return hasMore;
        }
        return false;
      } catch (err) {
        setIndexerError(err instanceof Error ? err.message : "Indexing failed");
        return false;
      } finally {
        if (!options?.continuous && !continuousRef.current) {
          setIndexerRunning(false);
        }
      }
    },
    [indexerBatchSize, indexerMode, recordIndexSlice],
  );

  const handleRunIndexerClick = async () => {
    beginIndexStint(indexerMode);
    priorRemainingRef.current = null;
    await runIndexerSlice();
  };

  const handleToggleContinuous = async (enable: boolean) => {
    setContinuousIndexing(enable);
    continuousRef.current = enable;
    if (enable && !indexerRunning) {
      beginIndexStint(indexerMode);
      setIndexerRunning(true);
      priorRemainingRef.current = indexStatus
        ? {
            emails: Math.max(0, indexStatus.totalEmails - indexStatus.indexedEmails),
            attachments: Math.max(
              0,
              indexStatus.totalParsedAttachments - indexStatus.indexedAttachments,
            ),
            visionPages: Math.max(
              0,
              indexStatus.totalDoneVisionPages - indexStatus.indexedVisionPages,
            ),
          }
        : null;
      let stalledSlices = 0;
      while (continuousRef.current) {
        const prior = priorRemainingRef.current;
        const hasMore = await runIndexerSlice({
          continuous: true,
          priorRemaining: prior ?? undefined,
        });
        if (!hasMore || !continuousRef.current) {
          break;
        }
        const next = priorRemainingRef.current;
        const processed =
          prior && next
            ? prior.emails +
              prior.attachments +
              prior.visionPages -
              (next.emails + next.attachments + next.visionPages)
            : 0;
        if (processed <= 0) {
          stalledSlices += 1;
          if (stalledSlices >= 5) {
            setIndexerError(
              "Continuous indexing stopped after repeated slices made no progress.",
            );
            break;
          }
        } else {
          stalledSlices = 0;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      setIndexerRunning(false);
      setContinuousIndexing(false);
      void loadStatus();
    }
  };

  // Search execution
  const executeSearch = async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q) return;

    setSearching(true);
    setSearchError(null);
    const start = performance.now();

    try {
      const res = await fetch("/api/analysis/corpus-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          limit: 15,
          sourceKind: sourceFilter === "all" ? undefined : sourceFilter,
        }),
      });

      const data = (await res.json()) as {
        results?: CorpusSearchResult[];
        count?: number;
        usage?: CorpusSearchUsage;
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Search failed");
      }

      setSearchResults(data.results ?? []);
      setLastSearchUsage(data.usage ?? null);
      if (data.usage?.costUsd) {
        setSessionSearchCostUsd((prev) => prev + data.usage!.costUsd);
      }
      setSearchDurationMs(Math.round(performance.now() - start));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeSearch(query);
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    void executeSearch(example);
  };

  const toggleChunkExpand = (id: string) => {
    setExpandedChunkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Helper to highlight matching tokens in excerpt text
  const renderHighlightedExcerpt = (excerpt: string, searchQuery: string) => {
    const tokens = searchQuery
      .toLowerCase()
      .split(/[^a-z0-9$]+/g)
      .filter((t) => t.length >= 3);

    if (tokens.length === 0) {
      return <span>{excerpt}</span>;
    }

    const regex = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
    const parts = excerpt.split(regex);

    return (
      <span>
        {parts.map((part, i) =>
          tokens.includes(part.toLowerCase()) ? (
            <mark
              key={i}
              className="rounded bg-amber-200 px-0.5 font-medium text-amber-950"
            >
              {part}
            </mark>
          ) : (
            <React.Fragment key={i}>{part}</React.Fragment>
          ),
        )}
      </span>
    );
  };

  const timingSnapshot = (() => {
    if (!indexStint || !indexStatus) return null;
    void timingTick;
    const snap = getCorpusIndexTimingSnapshot(indexStint, indexerRunning);
    const remainingInMode = corpusRemainingForMode(indexStatus, indexStint.mode);
    const remainingCorpus = corpusRemainingTotal(indexStatus);
    const rate = estimateCorpusIndexRate({
      stintMs: snap.stintMs,
      stintDocs: snap.stintDocs,
      remainingInMode,
      remainingCorpus,
    });
    const costRate = estimateCorpusEmbedCostRate({
      stintMs: snap.stintMs,
      stintCostUsd: indexStint.costUsd,
      docRate: rate,
      liveRolling: liveEmbedCost,
    });
    return { ...snap, rate, costRate, remainingInMode, remainingCorpus };
  })();

  const liveIndexedCostUsd =
    indexCosts &&
    liveEmbedCost?.charsPerToken &&
    liveEmbedCost.charsPerToken > 0
      ? indexCosts.indexedCostUsd *
        (4 / liveEmbedCost.charsPerToken)
      : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link
              href="/admin/analysis"
              className="hover:text-teal-800 hover:underline"
            >
              Analysis
            </Link>
            <span>/</span>
            <span className="font-semibold text-slate-700">Corpus Search</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Ask the Archive
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Natural-language semantic search across 7,000+ emails and parsed attachment documents using pgvector.
          </p>
        </div>
      </div>

      {/* Index Status & Operational Controls Panel */}
      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-800 uppercase">
            Corpus Index Status
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <span>Batch:</span>
              <select
                value={indexerBatchSize}
                onChange={(e) => setIndexerBatchSize(Number(e.target.value))}
                disabled={indexerRunning}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs shadow-xs focus:border-teal-500 focus:outline-hidden"
              >
                <option value={15}>15 items</option>
                <option value={25}>25 items</option>
                <option value={50}>50 items</option>
              </select>
            </label>

            <select
              value={indexerMode}
              onChange={(e) =>
                setIndexerMode(
                  e.target.value as "all" | "emails" | "attachments" | "vision",
                )
              }
              disabled={indexerRunning}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs shadow-xs focus:border-teal-500 focus:outline-hidden"
            >
              <option value="all">All Sources</option>
              <option value="emails">Emails Only</option>
              <option value="attachments">Attachments Only</option>
              <option value="vision">Vision Only</option>
            </select>

            <button
              type="button"
              onClick={handleRunIndexerClick}
              disabled={indexerRunning}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 disabled:opacity-50"
            >
              {indexerRunning && !continuousIndexing ? (
                <>
                  <Spinner />
                  Indexing slice…
                </>
              ) : (
                "Run Indexer Slice"
              )}
            </button>

            <button
              type="button"
              onClick={() => handleToggleContinuous(!continuousIndexing)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-xs ${
                continuousIndexing
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
            >
              {continuousIndexing ? (
                <>
                  <Spinner />
                  Stop Continuous Run
                </>
              ) : (
                "Run Continuously"
              )}
            </button>
          </div>
        </div>

        {/* Metric Cards */}
        {loadingStatus && !indexStatus ? (
          <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Emails Indexed</div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {indexStatus?.indexedEmails ?? 0}
                <span className="text-xs font-normal text-slate-500">
                  {" "}
                  / {indexStatus?.totalEmails ?? 0}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {indexStatus && indexStatus.totalEmails > 0
                  ? `${Math.round((indexStatus.indexedEmails / indexStatus.totalEmails) * 100)}% coverage`
                  : "—"}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Attachments Indexed</div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {indexStatus?.indexedAttachments ?? 0}
                <span className="text-xs font-normal text-slate-500">
                  {" "}
                  / {indexStatus?.totalParsedAttachments ?? 0}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {indexStatus && indexStatus.totalParsedAttachments > 0
                  ? `${Math.round((indexStatus.indexedAttachments / indexStatus.totalParsedAttachments) * 100)}% parsed files`
                  : "—"}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Vision Pages</div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {indexStatus?.indexedVisionPages ?? 0}
                <span className="text-xs font-normal text-slate-500">
                  {" "}
                  / {indexStatus?.totalDoneVisionPages ?? 0}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                done pages indexed
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Total Chunks (pgvector)</div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {indexStatus?.totalChunks.toLocaleString() ?? 0}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Last: {indexStatus?.lastIndexedAt ? formatDateTime(indexStatus.lastIndexedAt) : "Never"}
              </div>
            </div>
          </div>
        )}

        {timingSnapshot ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">
              {indexerRunning
                ? continuousIndexing
                  ? "Continuous indexing…"
                  : "Indexing slice…"
                : "Indexing stint complete"}
            </p>
            <p className="mt-1 text-xs text-amber-900/90">
              Mode: {corpusIndexModeLabel(indexStint!.mode)} · batch{" "}
              {indexerBatchSize}
              {timingSnapshot.stintDocs > 0
                ? ` · ${timingSnapshot.stintDocs.toLocaleString()} doc${timingSnapshot.stintDocs === 1 ? "" : "s"} this stint`
                : ""}
              {indexStint!.costUsd > 0
                ? ` · ${formatCostUsd(indexStint!.costUsd)} stint cost (${formatTokenCount(indexStint!.inputTokens)} billed)`
                : ""}
              {liveEmbedCost && liveEmbedCost.sampleCount > 0
                ? ` · ${formatEmbedCostPerMinute(liveEmbedCost.costPerMinute)} burn (60s avg)`
                : ""}
            </p>
            <div className="mt-3 grid gap-1 border-t border-amber-200/80 pt-3 text-xs text-amber-900/90 sm:grid-cols-2">
              <p className="tabular-nums">
                <span className="font-medium text-amber-950">Active time</span>
                {" · "}
                {formatCorpusIndexDuration(timingSnapshot.activeMs)}
              </p>
              <p className="tabular-nums">
                <span className="font-medium text-amber-950">This stint</span>
                {" · "}
                {timingSnapshot.stintDocs > 0
                  ? `${formatCorpusIndexDuration(timingSnapshot.stintMs)} · ${timingSnapshot.stintDocs.toLocaleString()} doc${timingSnapshot.stintDocs === 1 ? "" : "s"}`
                  : "—"}
              </p>
              <p className="tabular-nums">
                <span className="font-medium text-amber-950">Rate</span>
                {" · "}
                {formatCorpusIndexRate(timingSnapshot.rate.docsPerMinute)}
                {timingSnapshot.rate.secondsPerDoc > 0
                  ? ` (${timingSnapshot.rate.secondsPerDoc.toFixed(1)}s/doc)`
                  : ""}
              </p>
              <p className="tabular-nums">
                <span className="font-medium text-amber-950">
                  ETA ({corpusIndexModeLabel(indexStint!.mode)})
                </span>
                {" · "}
                {timingSnapshot.stintDocs > 0
                  ? formatCorpusIndexEta(timingSnapshot.rate.modeEtaMs)
                  : "—"}
                {timingSnapshot.remainingInMode > 0 &&
                timingSnapshot.stintDocs > 0
                  ? ` · ${timingSnapshot.remainingInMode.toLocaleString()} left`
                  : ""}
              </p>
              {timingSnapshot.stintDocs > 0 ? (
                <p className="tabular-nums sm:col-span-2">
                  <span className="font-medium text-amber-950">Corpus ETA</span>
                  {" · "}
                  {formatCorpusIndexEta(timingSnapshot.rate.corpusEtaMs)}
                  {" at this stint rate · "}
                  {timingSnapshot.remainingCorpus.toLocaleString()} sources
                  remaining overall
                </p>
              ) : null}
              {timingSnapshot.costRate.costPerMinute > 0 ? (
                <>
                  <p className="tabular-nums">
                    <span className="font-medium text-amber-950">
                      Est. cost ({corpusIndexModeLabel(indexStint!.mode)})
                    </span>
                    {" · "}
                    {formatEmbedCostEta(timingSnapshot.costRate.modeCostEtaUsd)}
                    {timingSnapshot.remainingInMode > 0
                      ? ` · ${timingSnapshot.remainingInMode.toLocaleString()} left`
                      : ""}
                  </p>
                  <p className="tabular-nums">
                    <span className="font-medium text-amber-950">
                      Corpus est. cost
                    </span>
                    {" · "}
                    {formatEmbedCostEta(timingSnapshot.costRate.corpusCostEtaUsd)}
                    {liveEmbedCost?.charsPerToken
                      ? ` · ~${liveEmbedCost.charsPerToken.toFixed(1)} chars/token (60s)`
                      : ""}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Embedding cost summary */}
        {indexCosts ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-teal-100 bg-teal-50/60 p-3">
              <div className="text-xs text-teal-800">Indexed Embedding Cost</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-teal-950">
                {liveIndexedCostUsd != null
                  ? formatCostUsd(liveIndexedCostUsd)
                  : formatCostUsd(indexCosts.indexedCostUsd)}
              </div>
              <div className="mt-1 text-xs text-teal-800">
                {liveIndexedCostUsd != null ? (
                  <>
                    Live est. from API token rate · char heuristic{" "}
                    {formatCostUsd(indexCosts.indexedCostUsd)}
                  </>
                ) : (
                  <>
                    {formatTokenCount(indexCosts.indexedInputTokens)} est. tokens
                    (chars÷4) · {indexCosts.modelName}
                  </>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
              <div className="text-xs text-amber-900">Est. Remaining Index Cost</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-amber-950">
                {indexCosts.extrapolation.formattedRemaining}
              </div>
              <div className="mt-1 text-xs text-amber-900">
                ~{indexCosts.extrapolation.estimatedRemainingChunks.toLocaleString()} chunks left
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600">Est. Total Index Cost</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                {indexCosts.extrapolation.formattedTotal}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                ${indexCosts.pricePerMillionInput.toFixed(2)} / 1M input tokens
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600">This Session</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                {formatCostUsd(sessionIndexCostUsd + sessionSearchCostUsd)}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Index {formatCostUsd(sessionIndexCostUsd)} · Search{" "}
                {formatCostUsd(sessionSearchCostUsd)}
              </div>
            </div>
          </div>
        ) : null}

        {/* Indexer Status Messages */}
        {indexerMessage ? (
          <p className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-800">
            {indexerMessage}
          </p>
        ) : null}
        {indexerError ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {indexerError}
          </p>
        ) : null}
      </div>

      {/* Search Input Bar */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask or search the archive (e.g. 'reserve fund study', 'elevator contract', 'roof inspection')…"
                className="w-full rounded-lg border border-slate-300 py-2.5 pr-4 pl-10 text-sm text-slate-900 shadow-xs placeholder:text-slate-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-hidden"
              />
            </div>

            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-teal-900 disabled:opacity-50"
            >
              {searching ? (
                <>
                  <Spinner />
                  Searching…
                </>
              ) : (
                "Search"
              )}
            </button>
          </div>

          {/* Quick Examples & Source Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500">Try:</span>
              {EXAMPLE_QUERIES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => handleExampleClick(example)}
                  className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700 hover:bg-teal-100 hover:text-teal-900"
                >
                  {example}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-slate-500">Filter:</span>
              {(
                [
                  ["all", "All"],
                  ["email_body", "Emails"],
                  ["attachment_markdown", "Attachments"],
                  ["attachment_vision_page", "Vision Pages"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setSourceFilter(kind)}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    sourceFilter === kind
                      ? "bg-slate-800 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>

      {/* Search Error */}
      {searchError ? (
        <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-800">
          Search error: {searchError}
        </div>
      ) : null}

      {/* Results Header */}
      {searchResults !== null && (
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-slate-600 uppercase">
            Found {searchResults.length} matching excerpts
            {searchDurationMs !== null ? ` in ${searchDurationMs}ms` : ""}
            {lastSearchUsage ? (
              <span className="ml-2 normal-case font-medium text-teal-800">
                · Query embed {formatCostUsd(lastSearchUsage.costUsd)} (
                {formatTokenCount(lastSearchUsage.inputTokens)} tokens)
              </span>
            ) : null}
          </span>
        </div>
      )}

      {/* Search Results List */}
      {searchResults !== null && (
        <div className="space-y-3">
          {searchResults.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No matching excerpts found for &ldquo;{query}&rdquo;.
              <p className="mt-1 text-xs text-slate-400">
                Tip: Run the indexer above to add more emails and attachments to the vector store.
              </p>
            </div>
          ) : (
            searchResults.map((result) => {
              const isExpanded = expandedChunkIds.has(result.id);
              const similarityPercent = Math.round(result.similarity * 100);

              return (
                <div
                  key={result.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-slate-300"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Similarity Badge */}
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                          similarityPercent >= 70
                            ? "bg-teal-100 text-teal-800"
                            : similarityPercent >= 50
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {similarityPercent}% match
                      </span>

                      {/* Source Kind Badge */}
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                          result.sourceKind === "email_body"
                            ? "bg-sky-100 text-sky-800"
                            : result.sourceKind === "attachment_markdown"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {result.sourceKind === "email_body"
                          ? "Email Body"
                          : result.sourceKind === "attachment_markdown"
                            ? "Attachment Doc"
                            : `Vision Page ${result.pageNo ?? ""}`}
                      </span>

                      {/* Filename or Subject */}
                      <span className="font-semibold text-slate-900 text-sm">
                        {result.metadata.filename || result.metadata.subject || "Document"}
                      </span>
                    </div>

                    {/* Source Links */}
                    <div className="flex items-center gap-2 text-xs">
                      {result.emailLink ? (
                        <Link
                          href={result.emailLink}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-teal-700 underline hover:text-teal-900"
                        >
                          Open Email ↗
                        </Link>
                      ) : null}

                      {result.sourceLink && result.sourceKind !== "email_body" ? (
                        <Link
                          href={result.sourceLink}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-purple-700 underline hover:text-purple-900"
                        >
                          View File ↗
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  {/* Metadata Row */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    {result.metadata.subject && result.sourceKind !== "email_body" ? (
                      <div>
                        <span className="font-medium text-slate-600">Email:</span> {result.metadata.subject}
                      </div>
                    ) : null}
                    {result.metadata.fromAddress ? (
                      <div>
                        <span className="font-medium text-slate-600">From:</span> {result.metadata.fromAddress}
                      </div>
                    ) : null}
                    {result.metadata.receivedAt ? (
                      <div>
                        <span className="font-medium text-slate-600">Date:</span>{" "}
                        {formatDateTime(result.metadata.receivedAt)}
                      </div>
                    ) : null}
                  </div>

                  {/* Excerpt Body */}
                  <div className="mt-2.5 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">
                    {isExpanded ? (
                      <div className="whitespace-pre-wrap">{result.chunkText}</div>
                    ) : (
                      renderHighlightedExcerpt(result.excerpt, query)
                    )}
                  </div>

                  {/* Expand / Collapse Full Chunk */}
                  <div className="mt-2 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => toggleChunkExpand(result.id)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800"
                    >
                      {isExpanded ? "Collapse excerpt ↑" : "Show full chunk text ↓"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
