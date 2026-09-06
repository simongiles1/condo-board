"use client";

import { useEffect, useMemo, useState } from "react";

import { IbmDoclingSpendPanel, type IbmDoclingSpendSummary } from "@/components/IbmDoclingSpendPanel";
import { PipelineStageInfoTooltip } from "@/components/PipelineStageInfoTooltip";
import {
  estimateCostBreakdown,
  flattenAiUsageToStages,
  formatCostUsd,
  formatPricePerMillion,
  formatTokenCount,
  getModelPricing,
  sumAiUsageStages,
  type AiUsageLog,
  type AiUsageStageRow,
} from "@/lib/gemini/usage";

type DialogTab = "usage" | "watsonx";

type Props = {
  open: boolean;
  usage?: AiUsageLog | null;
  stages?: AiUsageStageRow[] | null;
  loading?: boolean;
  onClose: () => void;
};

function TokenCostCell({
  tokenCount,
  costUsd,
  ratePerMillion,
  showRate = false,
}: {
  tokenCount: number;
  costUsd: number;
  ratePerMillion: number;
  showRate?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-slate-800">{formatTokenCount(tokenCount)}</div>
      <div className="font-mono text-xs text-slate-500">
        {formatCostUsd(costUsd)}
      </div>
      {showRate ? (
        <div className="font-mono text-[11px] text-slate-400">
          @ {formatPricePerMillion(ratePerMillion)}/M
        </div>
      ) : null}
    </div>
  );
}

function UsageStageRow({
  stage,
  showRatesInCells,
}: {
  stage: AiUsageStageRow;
  showRatesInCells: boolean;
}) {
  if (stage.notApplicable) {
    const subtitle =
      stage.stageKind === "user"
        ? "Manual"
        : stage.modelName !== "N/A"
          ? stage.modelName
          : "No LLM usage";

    return (
      <tr className="text-slate-500">
        <td className="px-4 py-3 align-top">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700">{stage.label}</span>
            <PipelineStageInfoTooltip stageId={stage.id} label={stage.label} />
            {stage.stageKind === "user" ? (
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Manual
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>
          {stage.usageDetail ? (
            <div className="mt-1 text-[11px] font-medium text-slate-600">{stage.usageDetail}</div>
          ) : null}
        </td>
        <td className="px-4 py-3 text-right align-top font-mono text-slate-400">N/A</td>
        <td className="px-4 py-3 text-right align-top font-mono text-slate-400">N/A</td>
        <td className="px-4 py-3 text-right align-top font-mono text-slate-400">N/A</td>
        <td className="px-4 py-3 text-right align-top font-mono text-slate-400">N/A</td>
      </tr>
    );
  }

  const breakdown = estimateCostBreakdown(stage.modelName, stage);

  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{stage.label}</span>
          <PipelineStageInfoTooltip stageId={stage.id} label={stage.label} />
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-slate-400">
          {stage.modelName}
        </div>
      </td>
      <td className="px-4 py-3 text-right align-top">
        <TokenCostCell
          tokenCount={stage.inputTokens}
          costUsd={breakdown.inputCostUsd}
          ratePerMillion={breakdown.pricing.inputPerMillion}
          showRate={showRatesInCells}
        />
      </td>
      <td className="px-4 py-3 text-right align-top">
        <TokenCostCell
          tokenCount={stage.outputTokens}
          costUsd={breakdown.outputCostUsd}
          ratePerMillion={breakdown.pricing.outputPerMillion}
          showRate={showRatesInCells}
        />
      </td>
      <td className="px-4 py-3 text-right align-top font-mono text-slate-800">
        {formatTokenCount(stage.totalTokens)}
      </td>
      <td className="px-4 py-3 text-right align-top font-mono font-medium text-slate-900">
        {formatCostUsd(breakdown.totalCostUsd)}
      </td>
    </tr>
  );
}

export function AiUsageDialog({ open, usage, stages, loading = false, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<DialogTab>("usage");
  const [watsonxSummary, setWatsonxSummary] = useState<IbmDoclingSpendSummary | null>(null);
  const [watsonxLoading, setWatsonxLoading] = useState(false);
  const [watsonxError, setWatsonxError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setActiveTab("usage");
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || activeTab !== "watsonx") return;

    let cancelled = false;
    setWatsonxLoading(true);
    setWatsonxError(null);

    async function loadWatsonxSummary() {
      try {
        const response = await fetch("/api/analysis/docling-backfill/ibm-spend");
        const payload = (await response.json()) as IbmDoclingSpendSummary & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load WatsonX key information.");
        }
        if (!cancelled) {
          setWatsonxSummary(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setWatsonxError(
            error instanceof Error ? error.message : "Could not load WatsonX key information.",
          );
          setWatsonxSummary(null);
        }
      } finally {
        if (!cancelled) {
          setWatsonxLoading(false);
        }
      }
    }

    void loadWatsonxSummary();

    return () => {
      cancelled = true;
    };
  }, [open, activeTab]);

  const resolvedStages = useMemo(() => {
    if (stages?.length) return stages;
    return flattenAiUsageToStages(usage);
  }, [stages, usage]);

  const totals = useMemo(
    () => sumAiUsageStages(resolvedStages),
    [resolvedStages],
  );
  const uniqueModels = useMemo(
    () => [...new Set(resolvedStages.filter((stage) => !stage.notApplicable).map((stage) => stage.modelName))],
    [resolvedStages],
  );
  const headerPricing =
    uniqueModels.length === 1 ? getModelPricing(uniqueModels[0]) : null;
  const showRatesInCells = uniqueModels.length !== 1;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-usage-title"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2
            id="ai-usage-title"
            className="text-xl font-semibold text-slate-900"
          >
            AI usage &amp; cost
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {activeTab === "usage"
              ? "All seven workflow steps — token costs for automated stages, manual steps marked N/A."
              : "IBM watsonx Docling trial keys loaded from .env.local and their spend."}
          </p>
          <div
            className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
            role="tablist"
            aria-label="AI usage views"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "usage"}
              onClick={() => setActiveTab("usage")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "usage"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Usage
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "watsonx"}
              onClick={() => setActiveTab("watsonx")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "watsonx"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              WatsonX
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {activeTab === "usage" ? (
            <>
          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Loading usage data…
            </div>
          ) : resolvedStages.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No usage data recorded for this meeting. Newly generated meetings
              track usage automatically; older meetings do not.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left font-semibold text-slate-700"
                    >
                      Stage
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right font-semibold text-slate-700"
                    >
                      <div>Input tokens</div>
                      <div className="mt-1 text-xs font-normal text-slate-500">
                        {headerPricing
                          ? `${formatPricePerMillion(headerPricing.inputPerMillion)}/M`
                          : "Rate varies by model"}
                      </div>
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right font-semibold text-slate-700"
                    >
                      <div>Output tokens</div>
                      <div className="mt-1 text-xs font-normal text-slate-500">
                        {headerPricing
                          ? `${formatPricePerMillion(headerPricing.outputPerMillion)}/M`
                          : "Rate varies by model"}
                      </div>
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right font-semibold text-slate-700"
                    >
                      Total tokens
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right font-semibold text-slate-700"
                    >
                      Est. cost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {resolvedStages.map((stage) => (
                    <UsageStageRow
                      key={stage.id}
                      stage={stage}
                      showRatesInCells={showRatesInCells}
                    />
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <th
                      scope="row"
                      className="px-4 py-3 text-left font-semibold text-slate-900"
                    >
                      Total
                    </th>
                    <td className="px-4 py-3 text-right align-top">
                      <div className="space-y-1">
                        <div className="font-mono font-semibold text-slate-900">
                          {formatTokenCount(totals.inputTokens)}
                        </div>
                        <div className="font-mono text-xs font-semibold text-slate-600">
                          {formatCostUsd(totals.inputCostUsd)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <div className="space-y-1">
                        <div className="font-mono font-semibold text-slate-900">
                          {formatTokenCount(totals.outputTokens)}
                        </div>
                        <div className="font-mono text-xs font-semibold text-slate-600">
                          {formatCostUsd(totals.outputCostUsd)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono font-semibold text-slate-900">
                      {formatTokenCount(totals.totalTokens)}
                    </td>
                    <td className="px-4 py-3 text-right align-top font-mono font-semibold text-teal-800">
                      {formatCostUsd(totals.costUsd)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {resolvedStages.length > 0 ? (
            <p className="mt-4 text-xs text-slate-500">
              Costs are recalculated from token counts using published model
              pricing. Ingest Docling page counts appear when markdown extraction
              was stored; dollar cost for Docling is on the WatsonX tab. Manual
              review steps have no API usage.
            </p>
          ) : null}
            </>
          ) : watsonxLoading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Loading WatsonX key information…
            </div>
          ) : watsonxError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {watsonxError}
            </div>
          ) : watsonxSummary ? (
            <div className="space-y-4">
              <IbmDoclingSpendPanel summary={watsonxSummary} />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Environment variables</p>
                <ul className="mt-2 space-y-1 font-mono text-xs text-slate-600">
                  <li>DOCLING_IBM_URL — hosted watsonx Docling base URL</li>
                  <li>DOCLING_IBM_API_KEY — primary trial API key</li>
                  <li>DOCLING_IBM_URL_2 / DOCLING_IBM_API_KEY_2 — extra trial slots (_3, _4)</li>
                  <li>DOCLING_IBM_USD_PER_PAGE — billed rate (default $0.004/page)</li>
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  Keys are read from .env.local on this machine. If URL_N is omitted, key N reuses
                  DOCLING_IBM_URL.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No WatsonX key information available.
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function AiUsageIconButton({
  onClick,
  disabled,
  title = "View AI usage and cost",
  tone = "default",
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "inverse";
}) {
  const toneClass =
    tone === "inverse"
      ? "border-white/15 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white"
      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    </button>
  );
}
