"use client";

import { useEffect, useState } from "react";

import {
  formatDeepSeekPricingTierLabel,
  formatDurationMs,
  formatInstantLocal,
  getDeepSeekPeakWindowRows,
  getDeepSeekPricingStatus,
  getLocalTimeZoneShort,
} from "@/lib/deepseek/pricing";

export type PipelineConfirmAction = "start" | "resume" | "rerun" | "restart";

type Props = {
  open: boolean;
  action: PipelineConfirmAction;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const ACTION_COPY: Record<
  PipelineConfirmAction,
  { title: string; description: string; confirmLabel: string; busyLabel: string }
> = {
  start: {
    title: "Start pipeline?",
    description:
      "This will ingest the transcript and board package, then run AI extraction and validation.",
    confirmLabel: "Start pipeline",
    busyLabel: "Starting…",
  },
  resume: {
    title: "Resume pipeline?",
    description: "Continue from the last completed step without wiping existing work.",
    confirmLabel: "Resume pipeline",
    busyLabel: "Resuming…",
  },
  rerun: {
    title: "Re-run pipeline?",
    description:
      "Run the full pipeline again. Existing extractions and drafts may be updated.",
    confirmLabel: "Re-run pipeline",
    busyLabel: "Re-running…",
  },
  restart: {
    title: "Restart from beginning?",
    description:
      "This permanently wipes all extracted data, investigations, and drafts for this meeting, then starts fresh.",
    confirmLabel: "Restart from beginning",
    busyLabel: "Restarting…",
  },
};

export function PipelineRunConfirmDialog({
  open,
  action,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const [pricingStatus, setPricingStatus] = useState(() => getDeepSeekPricingStatus());

  useEffect(() => {
    if (!open) return;
    setPricingStatus(getDeepSeekPricingStatus());
    const interval = window.setInterval(() => {
      setPricingStatus(getDeepSeekPricingStatus());
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [open]);

  if (!open) return null;

  const copy = ACTION_COPY[action];
  const inPeak = pricingStatus.tier === "peak";
  const peakWindows = getDeepSeekPeakWindowRows();
  const localTimeZone = getLocalTimeZoneShort();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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
        aria-labelledby="pipeline-confirm-title"
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id="pipeline-confirm-title" className="text-lg font-semibold text-slate-900">
          {copy.title}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{copy.description}</p>

        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            inPeak
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : "border-teal-200 bg-teal-50 text-teal-950"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-semibold">
              DeepSeek pricing: {formatDeepSeekPricingTierLabel(pricingStatus.tier)} hours
            </p>
            {inPeak ? (
              <span className="text-xs font-medium uppercase tracking-wide opacity-80">
                2× cost now
              </span>
            ) : null}
          </div>

          <p className="mt-2 text-xs font-medium uppercase tracking-wide opacity-70">
            Peak hours · Mon–Fri · {localTimeZone}
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-[13px] leading-snug">
            {peakWindows.map((window, index) => (
              <li key={index}>{window.localRange}</li>
            ))}
          </ul>

          {inPeak && pricingStatus.msUntilOffPeak != null && pricingStatus.nextOffPeakAtMs != null ? (
            <div
              className={`mt-3 border-t pt-3 ${
                inPeak ? "border-amber-200/80" : "border-teal-200/80"
              }`}
            >
              <p className="text-[13px] font-medium">
                Off-peak starts in {formatDurationMs(pricingStatus.msUntilOffPeak)}
              </p>
              <p className="mt-0.5 text-[13px] opacity-90">
                {formatInstantLocal(pricingStatus.nextOffPeakAtMs)}
              </p>
            </div>
          ) : (
            <p className="mt-3 border-t border-teal-200/80 pt-3 text-[13px] font-medium">
              You are currently in off-peak hours — lowest DeepSeek rates apply.
            </p>
          )}
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
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60 ${
              action === "restart"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-teal-600 hover:bg-teal-700"
            }`}
          >
            {busy ? copy.busyLabel : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
