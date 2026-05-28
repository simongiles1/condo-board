"use client";

import { useEffect, useMemo } from "react";

import {
  estimateCostBreakdown,
  formatCostUsd,
  formatPricePerMillion,
  formatTokenCount,
  getModelPricing,
  sumAiUsageRuns,
  type AiUsageLog,
  type AiUsageRun,
} from "@/lib/gemini/usage";

type Props = {
  open: boolean;
  usage: AiUsageLog | null;
  onClose: () => void;
};

function formatRanAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

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

function UsageRunRow({
  run,
  showRatesInCells,
}: {
  run: AiUsageRun;
  showRatesInCells: boolean;
}) {
  const breakdown = estimateCostBreakdown(run.modelName, run);

  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-slate-900">{run.label}</div>
        <div className="mt-0.5 text-xs text-slate-500">
          {formatRanAt(run.ranAt)}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-slate-400">
          {run.modelName}
        </div>
      </td>
      <td className="px-4 py-3 text-right align-top">
        <TokenCostCell
          tokenCount={run.inputTokens}
          costUsd={breakdown.inputCostUsd}
          ratePerMillion={breakdown.pricing.inputPerMillion}
          showRate={showRatesInCells}
        />
      </td>
      <td className="px-4 py-3 text-right align-top">
        <TokenCostCell
          tokenCount={run.outputTokens}
          costUsd={breakdown.outputCostUsd}
          ratePerMillion={breakdown.pricing.outputPerMillion}
          showRate={showRatesInCells}
        />
      </td>
      <td className="px-4 py-3 text-right align-top font-mono text-slate-800">
        {formatTokenCount(run.totalTokens)}
      </td>
      <td className="px-4 py-3 text-right align-top font-mono font-medium text-slate-900">
        {formatCostUsd(breakdown.totalCostUsd)}
      </td>
    </tr>
  );
}

export function AiUsageDialog({ open, usage, onClose }: Props) {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const runs = usage?.runs ?? [];
  const totals = useMemo(() => sumAiUsageRuns(runs), [runs]);
  const uniqueModels = useMemo(
    () => [...new Set(runs.map((run) => run.modelName))],
    [runs],
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
            Token counts and estimated Gemini API cost for each processing run.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {runs.length === 0 ? (
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
                      Run
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
                  {runs.map((run) => (
                    <UsageRunRow
                      key={run.id}
                      run={run}
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

          {runs.length > 0 ? (
            <p className="mt-4 text-xs text-slate-500">
              Costs are recalculated from token counts using published Gemini
              pricing. Retries and continuations during initial processing are
              included in the initial processing line item.
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
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
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
