"use client";

import { useEffect, useState } from "react";

import { DeepSeekPricingTimeline } from "@/components/DeepSeekPricingTimeline";
import { getDeepSeekPricingStatus } from "@/lib/deepseek/pricing";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Asks before a DeepSeek call and shows whether the current hour is peak pricing.
 */
export function DeepSeekActionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busyLabel = "Working…",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const pricingStatus = getDeepSeekPricingStatus(nowMs);

  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onCancel}
        disabled={busy}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deepseek-action-confirm-title"
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id="deepseek-action-confirm-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-4">
          <DeepSeekPricingTimeline pricingStatus={pricingStatus} atMs={nowMs} />
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
