"use client";

import { formatCostUsd } from "@/lib/gemini/usage";
import type { DeepSeekPricingTier } from "@/lib/deepseek/pricing";

export type PipelineCostContextPayload = {
  balance: {
    isAvailable: boolean;
    error?: string;
    currency: string;
    totalBalance: number | null;
    grantedBalance: number | null;
    toppedUpBalance: number | null;
  };
  estimates: {
    sampleCount: number;
    averageActualCostUsd: number | null;
    averageOffPeakCostUsd: number | null;
    averagePeakCostUsd: number | null;
  };
};

type Props = {
  loading: boolean;
  error: string | null;
  context: PipelineCostContextPayload | null;
  currentTier: DeepSeekPricingTier;
};

function formatBalanceAmount(value: number | null, currency: string): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase() === "CNY" ? "CNY" : "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function DeepSeekPipelineCostPanel({
  loading,
  error,
  context,
  currentTier,
}: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Loading DeepSeek balance and spend estimates…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {error}
      </div>
    );
  }

  if (!context) return null;

  const { balance, estimates } = context;
  const currentTierEstimate =
    currentTier === "peak"
      ? estimates.averagePeakCostUsd
      : estimates.averageOffPeakCostUsd;
  const alternateTierEstimate =
    currentTier === "peak"
      ? estimates.averageOffPeakCostUsd
      : estimates.averagePeakCostUsd;
  const alternateTierLabel = currentTier === "peak" ? "off-peak" : "peak";

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold text-slate-900">DeepSeek account balance</p>
        {!balance.isAvailable && balance.totalBalance !== null ? (
          <span className="text-xs font-medium uppercase tracking-wide text-amber-700">
            Low balance
          </span>
        ) : null}
      </div>

      {balance.error ? (
        <p className="mt-1 text-[13px] text-amber-800">{balance.error}</p>
      ) : balance.totalBalance !== null ? (
        <p className="mt-1 font-mono text-[15px] font-semibold text-slate-900">
          {formatBalanceAmount(balance.totalBalance, balance.currency)}
          <span className="ml-2 text-xs font-normal text-slate-500">
            {balance.currency}
          </span>
        </p>
      ) : (
        <p className="mt-1 text-[13px] text-slate-600">Balance unavailable.</p>
      )}

      {balance.totalBalance !== null &&
      (balance.grantedBalance ?? 0) + (balance.toppedUpBalance ?? 0) > 0 ? (
        <p className="mt-1 text-[11px] text-slate-500">
          Granted {formatBalanceAmount(balance.grantedBalance, balance.currency)} · Paid{" "}
          {formatBalanceAmount(balance.toppedUpBalance, balance.currency)}
        </p>
      ) : null}

      <div className="mt-3 border-t border-slate-200 pt-3">
        <p className="font-medium text-slate-900">Typical pipeline spend</p>
        {estimates.sampleCount > 0 && currentTierEstimate !== null ? (
          <>
            <p className="mt-1 text-[13px] text-slate-700">
              Average automated pipeline (extract + investigate + validate):{" "}
              <span className="font-mono font-semibold text-slate-900">
                {formatCostUsd(currentTierEstimate)}
              </span>{" "}
              at {currentTier === "peak" ? "peak" : "off-peak"} rates
            </p>
            {alternateTierEstimate !== null ? (
              <p className="mt-1 text-[12px] text-slate-500">
                Same workload at {alternateTierLabel} rates:{" "}
                <span className="font-mono text-slate-700">
                  {formatCostUsd(alternateTierEstimate)}
                </span>
              </p>
            ) : null}
            {estimates.averageActualCostUsd !== null ? (
              <p className="mt-1 text-[12px] text-slate-500">
                Historical average billed:{" "}
                <span className="font-mono text-slate-700">
                  {formatCostUsd(estimates.averageActualCostUsd)}
                </span>
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-slate-500">
              Based on {estimates.sampleCount} completed meeting
              {estimates.sampleCount === 1 ? "" : "s"} with per-call DeepSeek billing
              (legacy flat-rate estimates excluded).
            </p>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-slate-600">
            No completed meetings with reliable per-call DeepSeek billing yet. Estimates
            will appear after a full extract/investigate/validate run records token costs.
          </p>
        )}
      </div>
    </div>
  );
}
