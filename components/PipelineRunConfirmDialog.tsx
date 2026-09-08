"use client";

import { useEffect, useState } from "react";

import { DeepSeekPricingTimeline } from "@/components/DeepSeekPricingTimeline";
import { getDeepSeekPricingStatus } from "@/lib/deepseek/pricing";

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

  const copy = ACTION_COPY[action];

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
