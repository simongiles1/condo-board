"use client";

import { useCallback, useEffect, useState } from "react";

import { formatCostUsd, formatTokenCount } from "@/lib/gemini/usage";

type CostSummary = {
  processedEmailCount: number;
  unprocessedEmailCount: number;
  totalAnalyses: number;
  lastRun: {
    costUsd: number;
    modelName: string;
    processedAt: string;
    inputTokens: number;
    outputTokens: number;
  } | null;
  averages: {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    medianCostUsd: number;
    p95CostUsd: number;
    withAttachmentsCostUsd: number | null;
    withoutAttachmentsCostUsd: number | null;
  };
  extrapolation: {
    estimatedRemainingCostUsd: number;
    estimatedTotalCostUsd: number;
    formattedRemaining: string;
    formattedTotal: string;
  };
};

export function AnalysisLabClient() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const costRes = await fetch("/api/analysis/cost-summary");
      setSummary(await costRes.json());
    } catch {
      setError("Failed to load analysis data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runBulk() {
    if (
      !window.confirm(
        `Run analysis on all ${summary?.unprocessedEmailCount ?? 0} unprocessed emails? Estimated cost: ${summary?.extrapolation.formattedRemaining ?? "unknown"}`,
      )
    ) {
      return;
    }

    setBulkRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/analysis/analyze-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Bulk analysis failed.");
      }
      setMessage(`Processed ${data.processedCount} emails.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk analysis failed.");
    } finally {
      setBulkRunning(false);
    }
  }

  async function bridgeMeetings() {
    setError(null);
    const response = await fetch("/api/analysis/bridge-meetings", {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Bridge failed.");
      return;
    }
    setMessage(`Bridged ${data.bridgedCount} finalized meetings.`);
    await load();
  }

  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl bg-slate-100" />;
  }

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Email intelligence
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Analysis lab</h1>
        <p className="mt-1 text-sm text-slate-600">
          Start with one email, compare models, then scale up when cost and quality look right.
        </p>
      </div>

      {message ? (
        <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">{message}</p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {summary ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Processed emails" value={String(summary.processedEmailCount)} />
          <StatCard label="Unprocessed emails" value={String(summary.unprocessedEmailCount)} />
          <StatCard label="Avg cost / email" value={formatCostUsd(summary.averages.costUsd)} />
          <StatCard
            label="Est. remaining cost"
            value={summary.extrapolation.formattedRemaining}
          />
        </div>
      ) : null}

      {summary?.lastRun ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <h2 className="font-semibold text-slate-900">Last run</h2>
          <p className="mt-2 text-slate-600">
            {formatCostUsd(summary.lastRun.costUsd)} · {summary.lastRun.modelName} ·{" "}
            {formatTokenCount(summary.lastRun.inputTokens)} in /{" "}
            {formatTokenCount(summary.lastRun.outputTokens)} out ·{" "}
            {new Date(summary.lastRun.processedAt).toLocaleString()}
          </p>
        </div>
      ) : null}

      <p className="text-sm text-slate-600">
        Change the email analysis model in the header{" "}
        <span className="font-medium text-slate-800">Settings</span> dialog under{" "}
        <span className="font-medium text-slate-800">API models</span>.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={bulkRunning || !summary?.unprocessedEmailCount}
          onClick={() => void runBulk()}
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          {bulkRunning ? "Running bulk…" : "Run all unprocessed (opt-in)"}
        </button>
        <button
          type="button"
          onClick={() => void bridgeMeetings()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Bridge finalized meetings
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
