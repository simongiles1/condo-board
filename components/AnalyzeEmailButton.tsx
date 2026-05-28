"use client";

import { useEffect, useState } from "react";

import { formatDateTime } from "@/lib/format/datetime";
import { formatCostUsd, formatTokenCount } from "@/lib/gemini/usage";

import { ConfirmDialog } from "@/components/ConfirmDialog";

type AnalyzeResult = {
  sourceId: string;
  emailId: string;
  document: {
    summary?: string;
    document_type?: string;
    maintenance_events?: unknown[];
    budget_line_items?: unknown[];
    action_items?: unknown[];
  };
  counts: Record<string, number>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    modelName: string;
  };
  reprocessed: boolean;
};

type BatchAnalyzeResult = {
  results: AnalyzeResult[];
};

type AnalyzeEmailButtonProps =
  | {
      mode: "message";
      emailId: string;
      processedAt?: string | null;
    }
  | {
      mode: "thread";
      emailIds: string[];
      processedCount: number;
      totalCount: number;
    };

function mergeCounts(results: AnalyzeResult[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const result of results) {
    for (const [key, count] of Object.entries(result.counts)) {
      merged[key] = (merged[key] ?? 0) + count;
    }
  }
  return merged;
}

function mergeUsage(results: AnalyzeResult[]) {
  const inputTokens = results.reduce((sum, result) => sum + result.usage.inputTokens, 0);
  const outputTokens = results.reduce(
    (sum, result) => sum + result.usage.outputTokens,
    0,
  );
  const costUsd = results.reduce((sum, result) => sum + result.usage.costUsd, 0);
  const modelName = results[0]?.usage.modelName ?? "unknown";

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
    modelName,
  };
}

export function AnalyzeEmailButton(props: AnalyzeEmailButtonProps) {
  const [loadingMode, setLoadingMode] = useState<"none" | "loading" | "analyzing">("none");
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [batchResults, setBatchResults] = useState<AnalyzeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localProcessedAt, setLocalProcessedAt] = useState<string | null>(
    props.mode === "message" ? (props.processedAt ?? null) : null,
  );
  const [localProcessedCount, setLocalProcessedCount] = useState(
    props.mode === "thread" ? props.processedCount : 0,
  );
  const [reanalyzeConfirmOpen, setReanalyzeConfirmOpen] = useState(false);

  useEffect(() => {
    if (props.mode === "message") {
      setLocalProcessedAt(props.processedAt ?? null);
      return;
    }
    setLocalProcessedCount(props.processedCount);
  }, [props]);

  const isThread = props.mode === "thread";
  const allProcessed = isThread
    ? localProcessedCount >= props.totalCount && props.totalCount > 0
    : Boolean(localProcessedAt);
  const latestProcessedAt = props.mode === "message" ? localProcessedAt : undefined;
  const isBusy = loadingMode !== "none";
  const displayResults = batchResults ?? (result ? [result] : null);

  async function fetchAnalysis(reprocess: boolean, mode: "loading" | "analyzing") {
    setLoadingMode(mode);
    setError(null);

    if (reprocess || !allProcessed) {
      setResult(null);
      setBatchResults(null);
      setAnalysisVisible(false);
    }

    try {
      if (props.mode === "message") {
        const response = await fetch("/api/analysis/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailId: props.emailId, reprocess }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Analysis failed.");
        }
        setResult(data as AnalyzeResult);
        if (reprocess || !localProcessedAt) {
          setLocalProcessedAt(new Date().toISOString());
        }
      } else {
        const response = await fetch("/api/analysis/analyze-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emailIds: props.emailIds, reprocess }),
        });
        const data = (await response.json()) as BatchAnalyzeResult & { error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Analysis failed.");
        }
        setBatchResults(data.results);
        if (reprocess || localProcessedCount < props.totalCount) {
          setLocalProcessedCount(data.results.length);
        }
      }

      setAnalysisVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setLoadingMode("none");
    }
  }

  function handlePrimaryClick() {
    if (isBusy) return;

    if (allProcessed) {
      if (analysisVisible) {
        setAnalysisVisible(false);
        return;
      }

      if (displayResults) {
        setAnalysisVisible(true);
        return;
      }

      void fetchAnalysis(false, "loading");
      return;
    }

    void fetchAnalysis(false, "analyzing");
  }

  const mergedCounts = displayResults ? mergeCounts(displayResults) : null;
  const mergedUsage = displayResults ? mergeUsage(displayResults) : null;
  const summary =
    displayResults?.find((entry) => entry.document.summary)?.document.summary ??
    null;

  const primaryLabel =
    loadingMode === "loading"
      ? "Loading…"
      : loadingMode === "analyzing"
        ? "Analyzing…"
        : allProcessed && analysisVisible
          ? "Hide analysis"
          : allProcessed
            ? "View analysis"
            : isThread
              ? "Analyze this thread"
              : "Analyze this email";

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={handlePrimaryClick}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {primaryLabel}
        </button>
        {allProcessed ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (isThread) {
                setReanalyzeConfirmOpen(true);
                return;
              }
              void fetchAnalysis(true, "analyzing");
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isThread ? "Re-analyze thread" : "Re-analyze"}
          </button>
        ) : null}
        {latestProcessedAt ? (
          <span className="text-xs text-slate-500">
            Last processed {formatDateTime(latestProcessedAt)}
          </span>
        ) : null}
        {isThread && props.totalCount > 0 ? (
          <span className="text-xs text-slate-500">
            {localProcessedCount} of {props.totalCount} messages processed
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {analysisVisible && displayResults && mergedUsage && mergedCounts ? (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              <strong>Cost:</strong> {formatCostUsd(mergedUsage.costUsd)}
            </span>
            <span>
              <strong>Model:</strong> {mergedUsage.modelName}
            </span>
            <span>
              <strong>Tokens:</strong>{" "}
              {formatTokenCount(mergedUsage.inputTokens)} in /{" "}
              {formatTokenCount(mergedUsage.outputTokens)} out
            </span>
            {isThread ? (
              <span>
                <strong>Messages analyzed:</strong> {displayResults.length}
              </span>
            ) : null}
          </div>

          {summary ? <p className="text-sm text-slate-700">{summary}</p> : null}

          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(mergedCounts).map(([key, count]) => (
              <span
                key={key}
                className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700"
              >
                {key.replace(/_/g, " ")}: {count}
              </span>
            ))}
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-teal-700">
              Raw extraction JSON
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">
              {JSON.stringify(
                isThread
                  ? displayResults.map((entry) => ({
                      emailId: entry.emailId,
                      document: entry.document,
                    }))
                  : displayResults[0]?.document,
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ) : null}

      {isThread ? (
        <ConfirmDialog
          open={reanalyzeConfirmOpen}
          title="Re-analyze this thread?"
          description={
            <p>
              This runs AI analysis again on all {props.totalCount} messages.
              Previous extractions are replaced and this adds API cost.
            </p>
          }
          confirmLabel="Re-analyze thread"
          busyLabel="Re-analyzing…"
          busy={loadingMode === "analyzing"}
          onConfirm={() => {
            setReanalyzeConfirmOpen(false);
            void fetchAnalysis(true, "analyzing");
          }}
          onCancel={() => {
            if (loadingMode !== "analyzing") {
              setReanalyzeConfirmOpen(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
