"use client";

import { useEffect, useState } from "react";

import {
  DeepSeekPipelineCostPanel,
  type PipelineCostContextPayload,
} from "@/components/DeepSeekPipelineCostPanel";
import { DeepSeekPricingTimeline } from "@/components/DeepSeekPricingTimeline";
import { getDeepSeekPricingStatus } from "@/lib/deepseek/pricing";

export type AgendaApprovalConfirmMode = "approve" | "update";

type Props = {
  open: boolean;
  mode: AgendaApprovalConfirmMode;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const MODE_COPY: Record<
  AgendaApprovalConfirmMode,
  { title: string; description: string; confirmLabel: string; busyLabel: string }
> = {
  approve: {
    title: "Approve agenda and proceed?",
    description:
      "This saves your agenda review decisions and resumes the pipeline for evidence gathering and investigation on discussed items.",
    confirmLabel: "Approve agenda",
    busyLabel: "Approving…",
  },
  update: {
    title: "Update agenda approval?",
    description:
      "This saves your revised agenda review decisions and resumes the pipeline for any newly discussed items.",
    confirmLabel: "Update approval",
    busyLabel: "Updating…",
  },
};

export function AgendaApprovalConfirmDialog({
  open,
  mode,
  busy = false,
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

  const copy = MODE_COPY[mode];

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
        aria-labelledby="agenda-approval-confirm-title"
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id="agenda-approval-confirm-title" className="text-lg font-semibold text-slate-900">
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
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? copy.busyLabel : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
