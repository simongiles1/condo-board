"use client";

import { useEffect, useState } from "react";

import {
  DeepSeekPipelineCostPanel,
  type PipelineCostContextPayload,
} from "@/components/DeepSeekPipelineCostPanel";
import { DeepSeekPricingTimeline } from "@/components/DeepSeekPricingTimeline";
import { getDeepSeekPricingStatus } from "@/lib/deepseek/pricing";
import {
  segmentCompareModel,
  type SegmentCompareSlotChoice,
} from "@/lib/meeting-v2/segment-compare-models";

type Props = {
  open: boolean;
  rerun: boolean;
  combinationLabel: string;
  estimatedCostLabel: string | null;
  walk: SegmentCompareSlotChoice;
  edge: SegmentCompareSlotChoice;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function usesDeepSeekSlot(choice: SegmentCompareSlotChoice): boolean {
  return segmentCompareModel(choice.modelId).provider === "deepseek";
}

export function SegmentCompareRunConfirmDialog({
  open,
  rerun,
  combinationLabel,
  estimatedCostLabel,
  walk,
  edge,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [costContext, setCostContext] = useState<PipelineCostContextPayload | null>(null);
  const [costContextLoading, setCostContextLoading] = useState(false);
  const [costContextError, setCostContextError] = useState<string | null>(null);
  const pricingStatus = getDeepSeekPricingStatus(nowMs);
  const showDeepSeekContext = usesDeepSeekSlot(walk) || usesDeepSeekSlot(edge);

  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [open]);

  useEffect(() => {
    if (!open || !showDeepSeekContext) {
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
  }, [open, showDeepSeekContext]);

  if (!open) return null;

  const title = rerun ? "Re-run this combination?" : "Run this combination?";
  const confirmLabel = rerun ? "Re-run combination" : "Run combination";
  const busyLabel = rerun ? "Re-running…" : "Running…";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
        aria-labelledby="segment-compare-run-confirm-title"
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id="segment-compare-run-confirm-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {rerun
            ? "Starts a fresh lab run for the same walk × edge pair. The previous result stays until you remove it."
            : "Runs the segmenter compare lab for this walk × edge pair. Results are stored separately from the saved agenda extract."}
        </p>
        <p className="mt-2 text-sm text-slate-800">
          <span className="font-semibold">{combinationLabel}</span>
          {estimatedCostLabel ? (
            <>
              {" "}
              · Est.{" "}
              <span className="font-mono font-semibold">{estimatedCostLabel}</span>
            </>
          ) : null}
        </p>

        {showDeepSeekContext ? (
          <div className="mt-4 space-y-3">
            <DeepSeekPricingTimeline pricingStatus={pricingStatus} atMs={nowMs} />
            <DeepSeekPipelineCostPanel
              loading={costContextLoading}
              error={costContextError}
              context={costContext}
              currentTier={pricingStatus.tier}
            />
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            This combination uses Gemini only — billing follows your Google AI Studio account, not
            DeepSeek peak/off-peak pricing.
          </p>
        )}

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
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
