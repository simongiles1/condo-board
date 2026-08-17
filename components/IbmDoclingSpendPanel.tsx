"use client";

import { formatCostUsd } from "@/lib/gemini/usage";

export type IbmDoclingSpendSummary = {
  usdPerPage: number;
  trialPages: number;
  billedPages: number;
  billedUsd: number;
  remainingPages: number;
  remainingUsd: number;
  keyCount: number;
  activeSlot: number | null;
  coverage: {
    trialPagesRemaining: number;
    extraAccountsNeeded: number;
    extraTrialPages: number;
    extraTrialUsd: number;
    shortfallPages: number;
  };
  accounts: Array<{
    id: string;
    label: string;
    envSlot: number | null;
    instanceHint: string | null;
    trialPages: number;
    isActive: boolean;
    exhaustedAt: string | null;
    exhaustedReason: string | null;
    archivedAt: string | null;
    pagesUsed: number;
    costUsd: number;
    pagesRemaining: number;
    inEnv: boolean;
  }>;
};

export function IbmDoclingSpendPanel({
  summary,
  embedded = false,
}: {
  summary: IbmDoclingSpendSummary;
  embedded?: boolean;
}) {
  const visible = summary.accounts.filter((account) => !account.archivedAt);
  const coverage = summary.coverage;

  return (
    <div
      className={
        embedded
          ? "text-sm"
          : "rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
      }
    >
      {embedded ? null : (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium text-slate-900">IBM watsonx spend</p>
          <p className="text-xs text-slate-500">
            {summary.keyCount} key{summary.keyCount === 1 ? "" : "s"} in
            .env.local
            {summary.activeSlot != null
              ? ` · live key ${summary.activeSlot}`
              : ""}
          </p>
        </div>
      )}
      <dl className={`${embedded ? "" : "mt-2"} grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700 sm:grid-cols-3`}>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Billed
          </dt>
          <dd className="font-medium text-slate-900">
            {formatCostUsd(summary.billedUsd)} ·{" "}
            {summary.billedPages.toLocaleString()} pages
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Backlog
          </dt>
          <dd className="font-medium text-slate-900">
            {formatCostUsd(summary.remainingUsd)} ·{" "}
            {summary.remainingPages.toLocaleString()} pages
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Trial credit left
          </dt>
          <dd className="font-medium text-slate-900">
            {coverage.trialPagesRemaining.toLocaleString()} pages
          </dd>
        </div>
      </dl>
      {coverage.extraAccountsNeeded > 0 ? (
        <p className="mt-2 text-xs text-slate-600">
          Add {coverage.extraAccountsNeeded} more trial key
          {coverage.extraAccountsNeeded === 1 ? "" : "s"} as
          DOCLING_IBM_API_KEY_2 … _4.
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {visible.map((account) => {
            const usedPct = Math.min(
              100,
              account.trialPages > 0
                ? (account.pagesUsed / account.trialPages) * 100
                : 0,
            );
            const status = account.exhaustedAt
              ? account.exhaustedReason === "auth"
                ? "rejected"
                : "exhausted"
              : account.isActive
                ? "live"
                : account.inEnv
                  ? "standby"
                  : "not in .env";
            return (
              <li
                key={account.id}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      {account.envSlot != null
                        ? `Key ${account.envSlot}`
                        : account.label}
                      <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                        {status}
                      </span>
                    </p>
                    <p className="text-xs text-slate-600">
                      {account.pagesUsed.toLocaleString()} /{" "}
                      {account.trialPages.toLocaleString()} pages ·{" "}
                      {formatCostUsd(account.costUsd)}
                      {account.instanceHint
                        ? ` · ${account.instanceHint}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${
                      account.exhaustedAt
                        ? "bg-red-400"
                        : usedPct >= 90
                          ? "bg-amber-400"
                          : "bg-teal-600"
                    }`}
                    style={{ width: `${Math.max(usedPct, account.exhaustedAt ? 100 : 0)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-600">
          No IBM keys loaded. Set DOCLING_IBM_URL and DOCLING_IBM_API_KEY in
          .env.local, then extra trials as _2 _3 _4.
        </p>
      )}
    </div>
  );
}
