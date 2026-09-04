"use client";

import { useEffect, useMemo } from "react";

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
  const breakdown = estimateCostBreakdown(stage.modelName, stage);

  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-slate-900">{stage.label}</div>
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
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const resolvedStages = useMemo(() => {
    if (stages?.length) return stages;
    return flattenAiUsageToStages(usage);
  }, [stages, usage]);

  const totals = useMemo(
    () => sumAiUsageStages(resolvedStages),
    [resolvedStages],
  );
  const uniqueModels = useMemo(
    () => [...new Set(resolvedStages.map((stage) => stage.modelName))],
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
            Token counts and estimated API cost for each processing stage.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
              pricing. Retries and continuations are included in their stage
              rows when recorded.
            </p>
          ) : null}
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
