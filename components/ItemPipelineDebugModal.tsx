"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { formatCostUsd } from "@/lib/gemini/usage";
import {
  formatItemDebugRunLabel,
  ITEM_DEBUG_MODELS,
  ITEM_DEBUG_STEPS,
  firstIncompleteItemDebugStepIndex,
  isItemDebugStepNavigable,
  itemDebugStepMeta,
  type ItemDebugModelId,
  type ItemDebugRun,
  type ItemDebugStep,
  type ItemDebugStepKey,
  type ItemDebugWorkspace,
} from "@/lib/meeting-v2/item-debug-models";
import {
  ItemPipelineDebugOutputPanel,
  ItemPipelineDebugPromptPanel,
  itemDebugStepStatusIcon,
} from "@/components/ItemPipelineDebugViews";
import { buildItemDebugAgentBundleFromRun } from "@/lib/meeting-v2/item-debug-agent-bundle";

type Props = {
  open: boolean;
  meetingId: string;
  agendaItemId: string;
  onClose: () => void;
};

function statusTone(status: string): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "running") return "border-sky-200 bg-sky-50 text-sky-800";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function ItemPipelineDebugModal({ open, meetingId, agendaItemId, onClose }: Props) {
  const [workspace, setWorkspace] = useState<ItemDebugWorkspace | null>(null);
  const [run, setRun] = useState<ItemDebugRun | null>(null);
  const [activeStepKey, setActiveStepKey] = useState<ItemDebugStepKey>("evidence");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [jsonCopied, setJsonCopied] = useState(false);

  const activeStep = run?.steps.find((step) => step.key === activeStepKey) ?? null;
  const meta = itemDebugStepMeta(activeStepKey);

  const loadWorkspace = useCallback(async () => {
    const response = await fetch(`/api/v2/meetings/${meetingId}/items/${agendaItemId}/debug`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as ItemDebugWorkspace & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Failed to load debugger.");
    setWorkspace(payload);
    return payload;
  }, [agendaItemId, meetingId]);

  const loadRun = useCallback(
    async (runId: string) => {
      const response = await fetch(
        `/api/v2/meetings/${meetingId}/items/${agendaItemId}/debug/${runId}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as { run?: ItemDebugRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error || "Failed to load run.");
      setRun(payload.run);
      return payload.run;
    },
    [agendaItemId, meetingId],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

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
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const nextWorkspace = await loadWorkspace();
        if (cancelled) return;
        const latest = nextWorkspace.runs[0];
        if (latest) {
          await loadRun(latest.id);
        } else {
          setRun(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRun, loadWorkspace, open]);

  useEffect(() => {
    if (!activeStep) {
      setSystemPrompt("");
      setUserPrompt("");
      return;
    }
    setSystemPrompt(activeStep.systemPrompt);
    setUserPrompt(activeStep.userPrompt);
  }, [activeStep?.key, activeStep?.systemPrompt, activeStep?.userPrompt, run?.id]);

  const history = useMemo(() => workspace?.runs ?? [], [workspace]);

  async function createRun() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/items/${agendaItemId}/debug`, {
        method: "POST",
      });
      const payload = (await response.json()) as { run?: ItemDebugRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error || "Failed to create run.");
      setRun(payload.run);
      setActiveStepKey("evidence");
      await loadWorkspace();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  }

  async function runStepOn(current: ItemDebugRun, stepKey: ItemDebugStepKey): Promise<ItemDebugRun> {
    const step = current.steps.find((entry) => entry.key === stepKey);
    const response = await fetch(
      `/api/v2/meetings/${meetingId}/items/${agendaItemId}/debug/${current.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey,
          modelId: step?.modelId,
          thinking: step?.thinking ?? false,
          systemPrompt: stepKey === activeStepKey ? systemPrompt : step?.systemPrompt,
          userPrompt: stepKey === activeStepKey ? userPrompt : step?.userPrompt,
        }),
      },
    );
    const payload = (await response.json()) as { run?: ItemDebugRun; error?: string };
    if (!response.ok || !payload.run) throw new Error(payload.error || "Failed to run step.");
    setRun(payload.run);
    setActiveStepKey(stepKey);
    return payload.run;
  }

  async function runStep(stepKey: ItemDebugStepKey) {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      await runStepOn(run, stepKey);
      await loadWorkspace();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      let current = run;
      for (const step of ITEM_DEBUG_STEPS) {
        const latest = current.steps.find((entry) => entry.key === step.key);
        if (latest?.status === "completed") continue;
        current = await runStepOn(current, step.key);
        if (current.steps.find((entry) => entry.key === step.key)?.status === "failed") break;
      }
      await loadWorkspace();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusy(false);
    }
  }

  async function copyAgentBundle() {
    if (!run || !workspace) return;
    const bundle = buildItemDebugAgentBundleFromRun({
      meetingId,
      agendaItemId,
      item: workspace.item,
      run,
    });
    const text = `${JSON.stringify(bundle, null, 2)}\n`;
    try {
      await navigator.clipboard.writeText(text);
      setJsonCopied(true);
      window.setTimeout(() => setJsonCopied(false), 2000);
    } catch (copyError) {
      setJsonCopied(false);
      setError(
        copyError instanceof Error ? copyError.message : "Could not copy JSON to the clipboard.",
      );
    }
  }

  async function patchStep(patch: Partial<Pick<ItemDebugStep, "modelId" | "thinking">>) {
    if (!run || !activeStep) return;
    const nextSteps = run.steps.map((step) =>
      step.key === activeStep.key
        ? {
            ...step,
            ...patch,
            systemPrompt,
            userPrompt,
          }
        : step,
    );
    setRun({ ...run, steps: nextSteps });
    try {
      await fetch(`/api/v2/meetings/${meetingId}/items/${agendaItemId}/debug/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: [
            {
              key: activeStep.key,
              modelId: patch.modelId !== undefined ? patch.modelId : activeStep.modelId,
              thinking: patch.thinking !== undefined ? patch.thinking : activeStep.thinking,
              systemPrompt,
              userPrompt,
            },
          ],
        }),
      });
    } catch {
      // Keep local edits; next Run Step will persist prompts.
    }
  }

  if (!open) return null;

  const itemLabel = workspace
    ? `${workspace.item.itemNumber ? `${workspace.item.itemNumber}. ` : ""}${workspace.item.title}`
    : "Agenda item";

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[60] bg-slate-900/40"
        onClick={() => {
          if (!busy) onClose();
        }}
        aria-label="Close item pipeline debugger"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-pipeline-debug-title"
        className="fixed inset-4 z-[70] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl lg:inset-8"
      >
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Item pipeline debugger
            </p>
            <h2 id="item-pipeline-debug-title" className="mt-1 text-lg font-semibold text-slate-900">
              {itemLabel}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Sandbox only — these runs do not overwrite production investigation or validation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
              disabled={busy || history.length === 0}
              value={run?.id ?? ""}
              onChange={(event) => {
                const id = event.target.value;
                if (!id) return;
                setLoading(true);
                void loadRun(id)
                  .catch((loadError: unknown) => {
                    setError(loadError instanceof Error ? loadError.message : String(loadError));
                  })
                  .finally(() => setLoading(false));
              }}
            >
              {history.length === 0 ? <option value="">No previous runs</option> : null}
              {history.map((entry, index) => (
                <option key={entry.id} value={entry.id}>
                  {formatItemDebugRunLabel(entry, index)} · {formatCostUsd(entry.totalCostUsd)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !run}
              onClick={() => void copyAgentBundle()}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                jsonCopied
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              title="Copy prompts, outputs, and evidence inputs as JSON for agent analysis"
            >
              {jsonCopied ? "✓ Copied" : "Copy JSON"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void createRun()}
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              New run
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs lg:flex-nowrap lg:gap-x-4">
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
            <span>
              Tokens{" "}
              <strong className="text-slate-900">
                {(run?.totalInputTokens ?? 0).toLocaleString()} in / {(run?.totalOutputTokens ?? 0).toLocaleString()} out
              </strong>
            </span>
            <span>
              Spend <strong className="text-slate-900">{formatCostUsd(run?.totalCostUsd ?? 0)}</strong>
            </span>
            {run ? (
              <span className={`rounded-full border px-2 py-0.5 font-semibold ${statusTone(run.status)}`}>
                {run.status}
              </span>
            ) : null}
          </div>

          {run ? (
            <nav
              className="flex min-w-0 flex-1 items-center justify-start gap-0 overflow-x-auto lg:justify-center"
              aria-label="Pipeline steps"
            >
              {ITEM_DEBUG_STEPS.map((step, index) => {
                const current = run.steps.find((entry) => entry.key === step.key);
                const selected = activeStepKey === step.key;
                const navigable = isItemDebugStepNavigable(run.steps, step.key);
                const frontierIndex = firstIncompleteItemDebugStepIndex(run.steps);
                const connectorDone = index > 0 && index <= frontierIndex;
                return (
                  <span key={step.key} className="flex shrink-0 items-center">
                    {index > 0 ? (
                      <span
                        className={`mx-1 inline-block h-px w-3 shrink-0 sm:w-4 ${
                          connectorDone ? "bg-teal-500" : "bg-slate-300"
                        }`}
                        aria-hidden
                      />
                    ) : null}
                    <button
                      type="button"
                      disabled={!navigable}
                      title={
                        navigable
                          ? step.description
                          : `Complete ${ITEM_DEBUG_STEPS[frontierIndex]?.shortLabel ?? "the prior step"} first.`
                      }
                      onClick={() => {
                        if (navigable) setActiveStepKey(step.key);
                      }}
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                        selected
                          ? "bg-teal-700 text-white shadow-sm"
                          : navigable
                            ? "text-slate-700 hover:bg-white"
                            : "cursor-not-allowed text-slate-400"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none ${
                          selected
                            ? "bg-white/25 text-white"
                            : current?.status === "completed"
                              ? "bg-emerald-100 text-emerald-800"
                              : current?.status === "failed"
                                ? "bg-rose-100 text-rose-800"
                                : navigable
                                  ? "bg-slate-200 text-slate-600"
                                  : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {navigable ? itemDebugStepStatusIcon(current?.status) : "·"}
                      </span>
                      {step.shortLabel}
                    </button>
                  </span>
                );
              })}
            </nav>
          ) : (
            <nav className="hidden min-w-0 flex-1 items-center gap-2 overflow-x-auto text-slate-400 lg:flex">
              {ITEM_DEBUG_STEPS.map((step) => (
                <span key={step.key} className="whitespace-nowrap text-[11px] font-semibold">
                  {step.shortLabel}
                </span>
              ))}
            </nav>
          )}

          <div className="ml-auto flex shrink-0 gap-2">
            <button
              type="button"
              disabled={!run || busy}
              onClick={() => void runStep(activeStepKey)}
              title={`Run only the ${meta.shortLabel} step using the prompts and model settings below.`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy ? "Running…" : `Run ${meta.shortLabel}`}
            </button>
            <button
              type="button"
              disabled={!run || busy}
              onClick={() => void runAll()}
              title="Run every incomplete step in order (Evidence → Facts → Investigate → Validate → Draft), skipping steps already marked completed."
              className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Run remaining
            </button>
          </div>
        </div>

        {error ? (
          <p role="alert" className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm text-rose-800">
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && !run ? (
            <p className="px-5 py-8 text-sm text-slate-500">Loading debugger…</p>
          ) : !run ? (
            <div className="px-5 py-10 text-sm text-slate-600">
              No debug runs yet. Create a run to inspect evidence, facts, investigation, validation, and the
              rendered minutes snippet for this item.
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-2">
              <section className="min-h-0 overflow-y-auto border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{meta.label}</h3>
                    <p className="mt-1 text-xs text-slate-500">{meta.description}</p>
                  </div>
                  {meta.kind === "llm" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                        value={activeStep?.modelId ?? "deepseek-v4-flash"}
                        disabled={busy}
                        onChange={(event) => {
                          const modelId = event.target.value as ItemDebugModelId;
                          void patchStep({ modelId });
                        }}
                      >
                        {ITEM_DEBUG_MODELS.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={Boolean(activeStep?.thinking)}
                          disabled={busy}
                          onChange={(event) => void patchStep({ thinking: event.target.checked })}
                        />
                        Thinking
                      </label>
                    </div>
                  ) : (
                    <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      No LLM
                    </span>
                  )}
                </div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  System prompt
                </label>
                <textarea
                  className="mb-3 h-40 w-full rounded-xl border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] leading-relaxed"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  disabled={busy || meta.kind === "deterministic"}
                />
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  User prompt / input
                </label>
                <ItemPipelineDebugPromptPanel
                  stepKey={activeStepKey}
                  userPrompt={userPrompt}
                  onChange={setUserPrompt}
                  disabled={busy}
                />
              </section>
              <section className="min-h-0 overflow-y-auto p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <h3 className="text-sm font-semibold text-slate-900">Output</h3>
                  {activeStep?.usage ? (
                    <span>
                      {activeStep.usage.inputTokens.toLocaleString()} in /{" "}
                      {activeStep.usage.outputTokens.toLocaleString()} out ·{" "}
                      {formatCostUsd(activeStep.usage.costUsd)}
                      {activeStep.durationMs != null ? ` · ${Math.round(activeStep.durationMs / 100) / 10}s` : ""}
                    </span>
                  ) : null}
                </div>
                {activeStep?.error ? (
                  <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    {activeStep.error}
                  </p>
                ) : null}
                <ItemPipelineDebugOutputPanel stepKey={activeStepKey} step={activeStep} />
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
