"use client";

import { useEffect, useState } from "react";

import {
  DeepSeekPipelineCostPanel,
  type PipelineCostContextPayload,
} from "@/components/DeepSeekPipelineCostPanel";
import { DeepSeekPricingTimeline } from "@/components/DeepSeekPricingTimeline";
import { getDeepSeekPricingStatus } from "@/lib/deepseek/pricing";

export type PipelineConfirmAction = "start" | "resume" | "rerun" | "restart";

type Props = {
  open: boolean;
  action: PipelineConfirmAction;
  busy?: boolean;
  /** Live-meeting create: package prep only, not the full minutes pipeline. */
  variant?: "minutes" | "upcoming";
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

const UPCOMING_ACTION_COPY: Partial<
  Record<PipelineConfirmAction, { description: string; confirmLabel?: string }>
> = {
  start: {
    description:
      "This will ingest the board package, extract the agenda through your split point, link attachment pages to agenda items, then stop. Minutes investigation and validation do not run.",
    confirmLabel: "Prepare package",
  },
  resume: {
    description:
      "Continue package preparation from the last completed step (ingest, extract, or attachment linking).",
    confirmLabel: "Resume preparation",
  },
  rerun: {
    description:
      "Re-run package preparation. Agenda and attachment links may be rebuilt.",
    confirmLabel: "Re-run preparation",
  },
  restart: {
    description:
      "Wipe extracted agenda data for this meeting and run package preparation again from the uploaded PDF.",
  },
};

export function PipelineRunConfirmDialog({
  open,
  action,
  busy = false,
  variant = "minutes",
  onConfirm,
  onCancel,
}: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [costContext, setCostContext] = useState<PipelineCostContextPayload | null>(null);
  const [costContextLoading, setCostContextLoading] = useState(false);
  const [costContextError, setCostContextError] = useState<string | null>(null);
  const pricingStatus = getDeepSeekPricingStatus(nowMs);

  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setCostContext(null);
      setCostContextError(null);
      setCostContextLoading(false);
      return;
    }

    let cancelled = false;
    setCostContextLoading(true);
    setCostContextError(null);

    async function loadCostContext() {
      try {
        const response = await fetch("/api/v2/meetings/pipeline-cost-context");
        const payload = (await response.json()) as PipelineCostContextPayload & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load DeepSeek cost context.");
        }
        if (!cancelled) {
          setCostContext(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setCostContext(null);
          setCostContextError(
            error instanceof Error
              ? error.message
              : "Could not load DeepSeek cost context.",
          );
        }
      } finally {
        if (!cancelled) {
          setCostContextLoading(false);
        }
      }
    }

    void loadCostContext();

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const base = ACTION_COPY[action];
  const upcoming = variant === "upcoming" ? UPCOMING_ACTION_COPY[action] : null;
  const copy = {
    ...base,
    description: upcoming?.description ?? base.description,
    confirmLabel: upcoming?.confirmLabel ?? base.confirmLabel,
  };

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
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id="pipeline-confirm-title" className="text-lg font-semibold text-slate-900">
          {copy.title}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{copy.description}</p>

        <div className="mt-4 space-y-3">
          <DeepSeekPricingTimeline pricingStatus={pricingStatus} atMs={nowMs} />
          <DeepSeekPipelineCostPanel
            loading={costContextLoading}
            error={costContextError}
            context={costContext}
            currentTier={pricingStatus.tier}
          />
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
