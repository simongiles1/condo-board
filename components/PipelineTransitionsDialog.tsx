"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  PipelineTransitionPhase,
  PipelineTransitionsPayload,
  PipelineTransitionStep,
} from "@/lib/meeting-v2/pipeline-transitions";

type Props = {
  open: boolean;
  meetingId: string;
  meetingTitle: string | null;
  onClose: () => void;
};

type ExtractViewMode = "after" | "before" | "response" | "delta";

function formatJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resolveStepPayload(
  phaseKey: PipelineTransitionPhase["key"],
  step: PipelineTransitionStep,
  extractView: ExtractViewMode,
): unknown {
  if (phaseKey === "extract") {
    if (extractView === "before") return step.before ?? null;
    if (extractView === "response") return step.response ?? null;
    if (extractView === "delta") return step.delta ?? null;
    return step.after ?? null;
  }
  return step.data ?? null;
}

function PhaseBadge({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      {count}
    </span>
  );
}

export function PipelineTransitionsDialog({
  open,
  meetingId,
  meetingTitle,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PipelineTransitionsPayload | null>(null);
  const [activePhaseKey, setActivePhaseKey] =
    useState<PipelineTransitionPhase["key"]>("extract");
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [extractView, setExtractView] = useState<ExtractViewMode>("after");

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetch(`/api/v2/meetings/${meetingId}/pipeline-transitions`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            typeof body?.error === "string"
              ? body.error
              : "Failed to load pipeline transitions.";
          throw new Error(message);
        }
        return body as PipelineTransitionsPayload;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        const firstPhase = data.phases[0];
        const firstStep = firstPhase?.steps[0];
        setActivePhaseKey(firstPhase?.key ?? "extract");
        setActiveStepId(firstStep?.id ?? null);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setPayload(null);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load pipeline transitions.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, meetingId]);

  const activePhase = useMemo(
    () => payload?.phases.find((phase) => phase.key === activePhaseKey) ?? null,
    [payload, activePhaseKey],
  );

  const activeStep = useMemo(() => {
    if (!activePhase) return null;
    return (
      activePhase.steps.find((step) => step.id === activeStepId) ??
      activePhase.steps[0] ??
      null
    );
  }, [activePhase, activeStepId]);

  useEffect(() => {
    if (!activePhase) return;
    if (!activePhase.steps.some((step) => step.id === activeStepId)) {
      setActiveStepId(activePhase.steps[0]?.id ?? null);
    }
  }, [activePhase, activeStepId]);

  const displayJson = useMemo(() => {
    if (!activePhase || !activeStep) return "";
    return formatJson(resolveStepPayload(activePhase.key, activeStep, extractView));
  }, [activePhase, activeStep, extractView]);

  async function copyJson() {
    if (!displayJson) return;
    try {
      await navigator.clipboard.writeText(displayJson);
    } catch {
      // Clipboard may be unavailable in some contexts.
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
        disabled={loading}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pipeline-transitions-title"
        className="relative flex h-[min(90vh,880px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="shrink-0 border-b border-slate-200 px-5 py-4">
          <h2
            id="pipeline-transitions-title"
            className="text-lg font-semibold text-slate-900"
          >
            Pipeline JSON transitions
          </h2>
          {meetingTitle ? (
            <p className="mt-0.5 text-sm text-slate-600">{meetingTitle}</p>
          ) : null}
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Walk through how structured JSON evolves from incremental extraction
            through agenda items, evidence context, investigation, and validation.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-600">
              Loading pipeline transitions…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-6">
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </p>
            </div>
          ) : payload ? (
            <div className="flex h-full min-h-0 overflow-hidden">
              <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50">
                <div className="shrink-0 border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Phases
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {payload.phases.map((phase) => (
                    <button
                      key={phase.key}
                      type="button"
                      onClick={() => {
                        setActivePhaseKey(phase.key);
                        setActiveStepId(phase.steps[0]?.id ?? null);
                        if (phase.key === "extract") setExtractView("after");
                      }}
                      className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                        activePhaseKey === phase.key
                          ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                          : "text-slate-700 hover:bg-white/70"
                      }`}
                    >
                      <span className="font-medium">{phase.label}</span>
                      <PhaseBadge count={phase.steps.length} />
                    </button>
                  ))}
                </div>
              </aside>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {activePhase ? (
                  <>
                    <div className="shrink-0 border-b border-slate-200 px-4 py-3">
                      <p className="text-sm font-medium text-slate-900">
                        {activePhase.label}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {activePhase.description}
                      </p>
                    </div>

                    <div className="flex min-h-0 flex-1 overflow-hidden">
                      {activePhase.steps.length > 1 ? (
                        <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
                          <div className="shrink-0 border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Steps
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto p-2">
                            {activePhase.steps.map((step) => (
                              <button
                                key={step.id}
                                type="button"
                                onClick={() => setActiveStepId(step.id)}
                                className={`mb-1 w-full rounded-lg px-3 py-2 text-left transition ${
                                  activeStep?.id === step.id
                                    ? "bg-teal-50 text-teal-900 ring-1 ring-teal-200"
                                    : "text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                <div className="text-sm font-medium leading-snug">
                                  {step.label}
                                </div>
                                {step.subtitle ? (
                                  <div className="mt-0.5 text-xs text-slate-500">
                                    {step.subtitle}
                                  </div>
                                ) : null}
                                {step.noChange ? (
                                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                                    No change
                                  </div>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </aside>
                      ) : null}

                      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        {activePhase.key === "extract" && activeStep ? (
                          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
                            {(
                              [
                                ["after", "After state"],
                                ["before", "Before state"],
                                ["response", "Chunk response"],
                                ["delta", "Delta summary"],
                              ] as Array<[ExtractViewMode, string]>
                            ).map(([mode, label]) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setExtractView(mode)}
                                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                                  extractView === mode
                                    ? "bg-teal-700 text-white"
                                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                            {activeStep.delta ? (
                              <span className="ml-auto text-xs text-slate-500">
                                Topics {activeStep.delta.topicsBefore} →{" "}
                                {activeStep.delta.topicsAfter}
                                {activeStep.delta.addedTitles.length > 0
                                  ? ` · +${activeStep.delta.addedTitles.length} added`
                                  : ""}
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-2">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {activeStep?.label ?? "No data for this phase yet"}
                          </p>
                          {activeStep?.subtitle ? (
                            <p className="truncate text-xs text-slate-500">
                              {activeStep.subtitle}
                            </p>
                          ) : null}
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-4">
                          {activeStep && displayJson ? (
                            <pre className="rounded-lg border border-slate-200 bg-white p-4 font-mono text-xs leading-relaxed text-slate-900 shadow-sm">
                              {displayJson}
                            </pre>
                          ) : (
                            <p className="text-sm text-slate-600">
                              No saved JSON for this phase yet. Run the pipeline to
                              populate snapshots.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button
            type="button"
            onClick={() => void copyJson()}
            disabled={!displayJson || loading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50"
          >
            Copy JSON
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
