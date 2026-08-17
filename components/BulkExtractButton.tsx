"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CONTACT_HIGHLIGHT_MODELS,
  DEFAULT_CONTACT_HIGHLIGHT_MODEL,
  formatContactHighlightModelOptionLabel,
  type ContactHighlightModelId,
} from "@/lib/email-analysis/contact-highlight-models";
import {
  EVENT_HIGHLIGHT_MODELS,
  DEFAULT_EVENT_HIGHLIGHT_MODEL,
  formatEventHighlightModelOptionLabel,
  type EventHighlightModelId,
} from "@/lib/email-analysis/event-highlight-models";
import {
  TODO_HIGHLIGHT_MODELS,
  DEFAULT_TODO_HIGHLIGHT_MODEL,
  formatTodoHighlightModelOptionLabel,
  type TodoHighlightModelId,
} from "@/lib/email-analysis/todo-highlight-models";
import {
  ORG_HIGHLIGHT_MODELS,
  DEFAULT_ORG_HIGHLIGHT_MODEL,
  formatOrgHighlightModelOptionLabel,
  type OrgHighlightModelId,
} from "@/lib/email-analysis/org-highlight-models";
import {
  estimateBulkExtractRate,
  formatBulkExtractDuration,
  formatBulkExtractEta,
  formatBulkExtractRate,
  getBulkExtractTimingSnapshot,
} from "@/lib/email-analysis/bulk-extract-timing";
import { formatCostUsd } from "@/lib/gemini/usage";

type ExtractKind = "contacts" | "organizations" | "events" | "todos";

type BulkExtractRun = {
  id: string;
  kind: ExtractKind;
  modelId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  totalThreads: number;
  totalEmails: number;
  completedThreads: number;
  completedEmails: number;
  failedThreads: number;
  currentThreadIndex: number;
  currentThreadId: string | null;
  currentThreadSubject: string | null;
  currentEmailId: string | null;
  currentEmailLabel: string | null;
  currentPass: number | null;
  currentEmailIndex: number | null;
  currentEmailTotal: number | null;
  totalCostUsd: number;
  stintStartedAt: string | null;
  completedEmailsAtStintStart: number;
  activeElapsedMs: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
};

function statusLabel(status: BulkExtractRun["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function runStatusLabel(run: BulkExtractRun): string {
  if (run.status === "completed" && run.failedThreads > 0) {
    return "Completed with errors";
  }
  return statusLabel(run.status);
}

function statusClass(status: BulkExtractRun["status"]): string {
  switch (status) {
    case "running":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    case "completed":
      return "bg-emerald-50 text-emerald-900 ring-emerald-200";
    case "failed":
      return "bg-red-50 text-red-900 ring-red-200";
    case "cancelled":
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function runStatusClass(run: BulkExtractRun): string {
  if (run.status === "completed" && run.failedThreads > 0) {
    return "bg-amber-50 text-amber-900 ring-amber-200";
  }
  return statusClass(run.status);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function kindLabel(kind: ExtractKind): string {
  if (kind === "organizations") return "Organizations";
  if (kind === "events") return "Events";
  if (kind === "todos") return "To-dos";
  return "Contacts";
}

function normalizeBulkExtractRun(run: BulkExtractRun): BulkExtractRun {
  return {
    ...run,
    stintStartedAt: run.stintStartedAt ?? null,
    completedEmailsAtStintStart: run.completedEmailsAtStintStart ?? 0,
    activeElapsedMs: run.activeElapsedMs ?? 0,
  };
}

export function BulkExtractButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExtractKind>("contacts");
  const [contactModel, setContactModel] = useState<ContactHighlightModelId>(
    DEFAULT_CONTACT_HIGHLIGHT_MODEL,
  );
  const [orgModel, setOrgModel] = useState<OrgHighlightModelId>(
    DEFAULT_ORG_HIGHLIGHT_MODEL,
  );
  const [eventModel, setEventModel] = useState<EventHighlightModelId>(
    DEFAULT_EVENT_HIGHLIGHT_MODEL,
  );
  const [todoModel, setTodoModel] = useState<TodoHighlightModelId>(
    DEFAULT_TODO_HIGHLIGHT_MODEL,
  );
  const [runs, setRuns] = useState<BulkExtractRun[]>([]);
  const [activeRun, setActiveRun] = useState<BulkExtractRun | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetSummary, setTargetSummary] = useState<{
    totalThreads: number;
    totalEmails: number;
  } | null>(null);

  const activeRunIdRef = useRef<string | null>(null);
  const [timingTick, setTimingTick] = useState(0);

  const busy = activeRun?.status === "running" || starting;

  function applyRunSnapshot(run: BulkExtractRun) {
    const normalized = normalizeBulkExtractRun(run);
    setActiveRun(normalized);
    if (normalized.status === "running") {
      activeRunIdRef.current = normalized.id;
    } else if (activeRunIdRef.current === normalized.id) {
      activeRunIdRef.current = null;
    }
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== normalized.id);
      return [normalized, ...next];
    });
  }

  async function loadRuns() {
    setLoadingHistory(true);
    try {
      const response = await fetch("/api/analysis/bulk-extract/runs?limit=30");
      const data = (await response.json()) as {
        runs?: BulkExtractRun[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not load run history.");
      }
      const list = (data.runs ?? []).map(normalizeBulkExtractRun);
      setRuns(list);

      // Rehydrate the live panel after close/reopen (or remount).
      const running = list.find((r) => r.status === "running");
      if (running) {
        setActiveRun(running);
        activeRunIdRef.current = running.id;
      } else {
        const trackedId = activeRunIdRef.current;
        if (trackedId) {
          const tracked = list.find((r) => r.id === trackedId);
          if (tracked) {
            setActiveRun(tracked);
            activeRunIdRef.current = null;
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load runs.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadTargetSummary() {
    try {
      const response = await fetch("/api/analysis/bulk-extract/targets");
      const data = (await response.json()) as {
        totalThreads?: number;
        totalEmails?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not load extract targets.");
      }
      setTargetSummary({
        totalThreads: data.totalThreads ?? 0,
        totalEmails: data.totalEmails ?? 0,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load extract targets.",
      );
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadRuns();
    void loadTargetSummary();
  }, [open]);

  // Refresh a running run so progress stays live (server worker; tab can hide).
  useEffect(() => {
    const runId =
      activeRun?.status === "running"
        ? activeRun.id
        : activeRunIdRef.current;
    if (!runId) return;

    let cancelled = false;

    async function pollActiveRun() {
      try {
        const response = await fetch(
          `/api/analysis/bulk-extract/runs/${runId}`,
        );
        const data = (await response.json()) as {
          run?: BulkExtractRun;
          error?: string;
        };
        if (cancelled || !response.ok || !data.run) return;
        applyRunSnapshot(data.run);
      } catch {
        // Ignore transient poll failures; next tick retries.
      }
    }

    void pollActiveRun();
    const timer = window.setInterval(() => {
      void pollActiveRun();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRun?.id, activeRun?.status]);

  // Live stopwatch tick while a run is active.
  useEffect(() => {
    if (activeRun?.status !== "running") return;
    const timer = window.setInterval(() => {
      setTimingTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, activeRun?.status]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function patchRun(
    runId: string,
    patch: Record<string, unknown>,
  ): Promise<BulkExtractRun | null> {
    const response = await fetch(`/api/analysis/bulk-extract/runs/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await response.json()) as {
      run?: BulkExtractRun;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Could not update bulk extract run.");
    }
    if (data.run) {
      applyRunSnapshot(data.run);
      return data.run;
    }
    return null;
  }

  function canResumeRun(run: BulkExtractRun): boolean {
    return run.status !== "running" && run.completedThreads < run.totalThreads;
  }

  async function ensureExtractTargets(): Promise<void> {
    const response = await fetch("/api/analysis/bulk-extract/targets");
    const data = (await response.json()) as {
      totalThreads?: number;
      totalEmails?: number;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Could not load extract targets.");
    }
    const totalThreads = data.totalThreads ?? 0;
    const totalEmails = data.totalEmails ?? 0;
    if (totalEmails === 0) {
      throw new Error("No emails to extract.");
    }
    setTargetSummary({ totalThreads, totalEmails });
  }

  async function runExtraction() {
    if (busy) return;
    setError(null);
    setStarting(true);

    const selectedKind = kind;
    const modelId =
      selectedKind === "organizations"
        ? orgModel
        : selectedKind === "events"
          ? eventModel
          : selectedKind === "todos"
            ? todoModel
            : contactModel;

    try {
      await ensureExtractTargets();

      const createResponse = await fetch("/api/analysis/bulk-extract/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: selectedKind, model: modelId }),
      });
      const createData = (await createResponse.json()) as {
        run?: BulkExtractRun;
        error?: string;
      };
      if (!createResponse.ok || !createData.run) {
        throw new Error(createData.error || "Could not start bulk extract run.");
      }

      applyRunSnapshot(createData.run);
      router.refresh();
      await loadRuns();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Bulk extraction failed.",
      );
    } finally {
      setStarting(false);
    }
  }

  async function resumeExtraction(source: BulkExtractRun) {
    if (busy || !canResumeRun(source)) return;
    setError(null);
    setStarting(true);

    try {
      await ensureExtractTargets();

      const resumeResponse = await fetch(
        `/api/analysis/bulk-extract/runs/${source.id}/resume`,
        { method: "POST" },
      );
      const resumeData = (await resumeResponse.json()) as {
        run?: BulkExtractRun;
        error?: string;
      };
      if (!resumeResponse.ok || !resumeData.run) {
        throw new Error(resumeData.error || "Could not resume bulk extract run.");
      }

      const run = resumeData.run;
      applyRunSnapshot(run);
      setKind(run.kind);
      if (run.kind === "contacts") {
        setContactModel(run.modelId as ContactHighlightModelId);
      } else if (run.kind === "events") {
        setEventModel(run.modelId as EventHighlightModelId);
      } else if (run.kind === "todos") {
        setTodoModel(run.modelId as TodoHighlightModelId);
      } else {
        setOrgModel(run.modelId as OrgHighlightModelId);
      }

      router.refresh();
      await loadRuns();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Bulk extraction failed.",
      );
    } finally {
      setStarting(false);
    }
  }

  async function cancelRun() {
    const runId = activeRunIdRef.current ?? activeRun?.id;
    if (runId && activeRun?.status === "running") {
      try {
        await patchRun(runId, {
          status: "cancelled",
          lastError: "Cancelled by user.",
        });
      } catch {
        // ignore
      }
    }
  }

  function closeModal() {
    setOpen(false);
    if (!busy) setError(null);
  }

  const selectedModelLabel =
    kind === "organizations"
      ? formatOrgHighlightModelOptionLabel(orgModel)
      : kind === "events"
        ? formatEventHighlightModelOptionLabel(eventModel)
        : kind === "todos"
          ? formatTodoHighlightModelOptionLabel(todoModel)
          : formatContactHighlightModelOptionLabel(contactModel);

  const live = activeRun?.status === "running" ? activeRun : null;

  const timingRun =
    activeRun &&
    (activeRun.status === "running" ||
      activeRun.status === "failed" ||
      activeRun.status === "cancelled")
      ? activeRun
      : null;

  const timingSnapshot = (() => {
    if (!timingRun) return null;
    void timingTick;
    const snapshot = getBulkExtractTimingSnapshot(timingRun);
    const rate = estimateBulkExtractRate({
      stintMs: snapshot.stintMs,
      stintEmails: snapshot.stintEmails,
      totalEmails: timingRun.totalEmails,
      completedEmails: timingRun.completedEmails,
    });
    return { ...snapshot, rate };
  })();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        {busy ? "Bulk extract…" : "Bulk extract"}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={closeModal}
            aria-label="Close dialog"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-extract-title"
            className="relative flex max-h-[min(90dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2
                    id="bulk-extract-title"
                    className="text-xl font-semibold text-slate-900"
                  >
                    Bulk extraction
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Run contact, organization, or event extraction across
                    every thread in the inbox. Runs on the server — you can
                    close this dialog, use another tab, or let the screensaver
                    run; reopen anytime to check progress. If a run fails or
                    is stopped, use Resume to continue from the last completed
                    thread.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700">
                    Extraction type
                  </span>
                  <select
                    value={kind}
                    disabled={busy}
                    onChange={(event) =>
                      setKind(event.target.value as ExtractKind)
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                  >
                    <option value="contacts">Contacts</option>
                    <option value="organizations">Organizations</option>
                    <option value="events">Events</option>
                    <option value="todos">To-dos</option>
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700">
                    Model
                  </span>
                  {kind === "contacts" ? (
                    <select
                      value={contactModel}
                      disabled={busy}
                      onChange={(event) =>
                        setContactModel(
                          event.target.value as ContactHighlightModelId,
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                    >
                      {CONTACT_HIGHLIGHT_MODELS.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {formatContactHighlightModelOptionLabel(modelId)}
                        </option>
                      ))}
                    </select>
                  ) : kind === "events" ? (
                    <select
                      value={eventModel}
                      disabled={busy}
                      onChange={(event) =>
                        setEventModel(
                          event.target.value as EventHighlightModelId,
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                    >
                      {EVENT_HIGHLIGHT_MODELS.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {formatEventHighlightModelOptionLabel(modelId)}
                        </option>
                      ))}
                    </select>
                  ) : kind === "todos" ? (
                    <select
                      value={todoModel}
                      disabled={busy}
                      onChange={(event) =>
                        setTodoModel(
                          event.target.value as TodoHighlightModelId,
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                    >
                      {TODO_HIGHLIGHT_MODELS.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {formatTodoHighlightModelOptionLabel(modelId)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={orgModel}
                      disabled={busy}
                      onChange={(event) =>
                        setOrgModel(event.target.value as OrgHighlightModelId)
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60"
                    >
                      {ORG_HIGHLIGHT_MODELS.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {formatOrgHighlightModelOptionLabel(modelId)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              </div>

              {targetSummary ? (
                <p className="text-sm text-slate-600">
                  Will process{" "}
                  <span className="font-medium text-slate-900">
                    {targetSummary.totalThreads.toLocaleString()} thread
                    {targetSummary.totalThreads === 1 ? "" : "s"}
                  </span>{" "}
                  (
                  {targetSummary.totalEmails.toLocaleString()} email
                  {targetSummary.totalEmails === 1 ? "" : "s"}) with{" "}
                  {kind === "events"
                    ? "one calendar harvest pass"
                    : kind === "todos"
                      ? "one to-do harvest pass"
                      : "all 4 passes"}{" "}
                  · {selectedModelLabel.split(" (")[0]}
                  {kind === "events" ? (
                    <>
                      . Calendar rows are applied when the run finishes, in
                      email date order, so cancels and reschedules still match
                      across threads.
                    </>
                  ) : kind === "todos" ? (
                    <>
                      . Asks from the last 120 days land on the open list;
                      older harvests are stored as archive and do not clutter
                      the dashboard.
                    </>
                  ) : null}
                </p>
              ) : null}

              {live ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      Running {kindLabel(live.kind)} extraction
                      <span className="ml-2 rounded-md bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                        Server
                      </span>
                    </p>
                    <p className="font-semibold tabular-nums">
                      Cost {formatCostUsd(live.totalCostUsd)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-amber-800/90">
                    Processing on the dev server — safe to hide this dialog or
                    switch tabs. Status updates every few seconds.
                  </p>
                  <p className="mt-2 text-amber-900/90">
                    Thread {live.currentThreadIndex || "—"} / {live.totalThreads}
                    {live.currentThreadSubject
                      ? ` · ${live.currentThreadSubject}`
                      : ""}
                  </p>
                  <p className="mt-1 text-amber-900/90">
                    {live.currentPass
                      ? `Pass ${live.currentPass} of 4`
                      : "Preparing…"}
                    {live.currentEmailIndex != null &&
                    live.currentEmailTotal != null
                      ? ` · email ${live.currentEmailIndex} / ${live.currentEmailTotal}`
                      : ""}
                  </p>
                  {live.currentEmailLabel ? (
                    <p className="mt-1 truncate text-amber-900/80">
                      {live.currentEmailLabel}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-amber-800/80">
                    Done: {live.completedThreads} thread
                    {live.completedThreads === 1 ? "" : "s"} ·{" "}
                    {live.completedEmails} email
                    {live.completedEmails === 1 ? "" : "s"}
                    {live.failedThreads > 0
                      ? ` · ${live.failedThreads} failed`
                      : ""}
                  </p>
                  {timingSnapshot ? (
                    <div className="mt-3 grid gap-1 border-t border-amber-200/80 pt-3 text-xs text-amber-900/90 sm:grid-cols-2">
                      <p className="tabular-nums">
                        <span className="font-medium text-amber-950">
                          Active time
                        </span>
                        {" · "}
                        {formatBulkExtractDuration(timingSnapshot.activeMs)}
                      </p>
                      <p className="tabular-nums">
                        <span className="font-medium text-amber-950">
                          This stint
                        </span>
                        {" · "}
                        {timingSnapshot.isRunning
                          ? `${formatBulkExtractDuration(timingSnapshot.stintMs)} · ${timingSnapshot.stintEmails.toLocaleString()} email${timingSnapshot.stintEmails === 1 ? "" : "s"}`
                          : timingSnapshot.stintEmails > 0
                            ? `${formatBulkExtractDuration(timingSnapshot.stintMs)} · ${timingSnapshot.stintEmails.toLocaleString()} email${timingSnapshot.stintEmails === 1 ? "" : "s"}`
                            : "—"}
                      </p>
                      <p className="tabular-nums">
                        <span className="font-medium text-amber-950">Rate</span>
                        {" · "}
                        {formatBulkExtractRate(timingSnapshot.rate.emailsPerMinute)}
                        {timingSnapshot.rate.secondsPerEmail > 0
                          ? ` (${timingSnapshot.rate.secondsPerEmail.toFixed(1)}s/email)`
                          : ""}
                      </p>
                      <p className="tabular-nums">
                        <span className="font-medium text-amber-950">ETA</span>
                        {" · "}
                        {formatBulkExtractEta(timingSnapshot.rate.etaMs)}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!live && timingSnapshot && canResumeRun(activeRun!) ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                  <p className="font-semibold text-slate-900">Run paused</p>
                  <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                    <p className="tabular-nums">
                      <span className="font-medium text-slate-800">
                        Active time
                      </span>
                      {" · "}
                      {formatBulkExtractDuration(timingSnapshot.activeMs)}
                    </p>
                    <p className="tabular-nums">
                      <span className="font-medium text-slate-800">Rate</span>
                      {" · "}
                      {formatBulkExtractRate(timingSnapshot.rate.emailsPerMinute)}
                    </p>
                    <p className="tabular-nums sm:col-span-2">
                      <span className="font-medium text-slate-800">ETA</span>
                      {" · "}
                      {formatBulkExtractEta(timingSnapshot.rate.etaMs)} if resumed
                      now
                    </p>
                  </div>
                </div>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              ) : null}

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Past runs
                  </h3>
                  {loadingHistory ? (
                    <span className="text-xs text-slate-500">Loading…</span>
                  ) : null}
                </div>
                {runs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
                    No bulk extraction runs yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {runs.map((run) => (
                      <li
                        key={run.id}
                        className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 text-sm"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${runStatusClass(run)}`}
                            >
                              {runStatusLabel(run)}
                            </span>
                            <span className="font-medium text-slate-900">
                              {kindLabel(run.kind)}
                            </span>
                            <span className="text-slate-500">{run.modelId}</span>
                          </div>
                          <p className="text-xs text-slate-500">
                            {formatWhen(run.startedAt)}
                            {run.finishedAt
                              ? ` → ${formatWhen(run.finishedAt)}`
                              : ""}
                            {" · "}
                            {run.completedThreads}/{run.totalThreads} threads
                            {run.failedThreads > 0
                              ? ` · ${run.failedThreads} failed`
                              : ""}
                          </p>
                          {run.lastError ? (
                            <p className="text-xs text-red-700">{run.lastError}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <p className="font-semibold tabular-nums text-slate-900">
                            {formatCostUsd(run.totalCostUsd)}
                          </p>
                          {canResumeRun(run) && !busy ? (
                            <button
                              type="button"
                              onClick={() => void resumeExtraction(run)}
                              className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                            >
                              Resume from {run.completedThreads}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-6 py-4">
              {busy ? (
                <>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Hide
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelRun()}
                    className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    Stop run
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              )}
              <button
                type="button"
                disabled={busy || (targetSummary?.totalEmails ?? 0) === 0}
                onClick={() => void runExtraction()}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {starting
                  ? "Starting…"
                  : busy
                    ? "Running…"
                    : `Start ${kindLabel(kind).toLowerCase()} extraction`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
