"use client";

import { useEffect, useState } from "react";

import {
  mergeActionLabel,
  sectionPathLabel,
  todoMergeActionLabel,
  type OmissionFinding,
  type OmissionsAnalysisResult,
  type TodoOmissionFinding,
} from "@/lib/minutes/omissions-schema";

type OmissionsTab = "minutes" | "todos";

type Props = {
  open: boolean;
  analysis: OmissionsAnalysisResult | null;
  loading: boolean;
  applyingMinutes: boolean;
  applyingTodos: boolean;
  error: string | null;
  warnings: string[];
  finalized: boolean;
  minutesDivergesFromPdfSource: boolean;
  onClose: () => void;
  onStartCheck: () => void;
  onReRun: () => void;
  onApplyMinutes: (selected: OmissionFinding[]) => void;
  onApplyTodos: (selected: TodoOmissionFinding[]) => void;
};

function formatAnalyzedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function OmissionsTabStrip({
  active,
  onChange,
  minutesCount,
  todosCount,
}: {
  active: OmissionsTab;
  onChange: (tab: OmissionsTab) => void;
  minutesCount: number;
  todosCount: number;
}) {
  const tabs: { id: OmissionsTab; label: string; count: number }[] = [
    { id: "minutes", label: "Meeting minutes", count: minutesCount },
    { id: "todos", label: "To-do list", count: todosCount },
  ];

  return (
    <div
      className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Omissions results"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? -1 : 0}
            onClick={() => {
              if (!selected) onChange(tab.id);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
            {tab.count > 0 ? (
              <span className="ml-1.5 text-xs font-medium text-slate-500">
                ({tab.count})
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function MinutesOmissionsList({
  omissions,
  selectedIds,
  finalized,
  applying,
  onToggle,
}: {
  omissions: OmissionFinding[];
  selectedIds: Set<string>;
  finalized: boolean;
  applying: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="space-y-4">
      {omissions.map((omission) => (
        <li
          key={omission.id}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={selectedIds.has(omission.id)}
              onChange={() => onToggle(omission.id)}
              disabled={finalized || applying}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">
                  {omission.topic}
                </span>
                <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  {sectionPathLabel(omission.targetSection)}
                </span>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    omission.mergeAction === "augment_existing"
                      ? "bg-teal-100 text-teal-900"
                      : "bg-violet-100 text-violet-900"
                  }`}
                >
                  {mergeActionLabel(
                    omission.mergeAction,
                    omission.existingItemIndex,
                  )}
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Missing detail
                </p>
                <p className="mt-0.5 text-sm text-slate-800">
                  {omission.missingDetail}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Why it matters
                </p>
                <p className="mt-0.5 text-sm text-slate-800">
                  {omission.whyItMatters}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {omission.mergeAction === "augment_existing"
                    ? "Will update existing item"
                    : "Will add to minutes"}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {omission.agendaItem.topic}
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  {omission.agendaItem.summary}
                </p>
              </div>
            </div>
          </label>
        </li>
      ))}
    </ul>
  );
}

function TodosOmissionsList({
  omissions,
  selectedIds,
  finalized,
  applying,
  onToggle,
}: {
  omissions: TodoOmissionFinding[];
  selectedIds: Set<string>;
  finalized: boolean;
  applying: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="space-y-4">
      {omissions.map((omission) => (
        <li
          key={omission.id}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={selectedIds.has(omission.id)}
              onChange={() => onToggle(omission.id)}
              disabled={finalized || applying}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">
                  {omission.assignee}
                </span>
                <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  {omission.role}
                </span>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    omission.mergeAction === "augment_existing"
                      ? "bg-teal-100 text-teal-900"
                      : "bg-violet-100 text-violet-900"
                  }`}
                >
                  {todoMergeActionLabel(
                    omission.mergeAction,
                    omission.existingTaskIndex,
                  )}
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Missing detail
                </p>
                <p className="mt-0.5 text-sm text-slate-800">
                  {omission.missingDetail}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Why it matters
                </p>
                <p className="mt-0.5 text-sm text-slate-800">
                  {omission.whyItMatters}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {omission.mergeAction === "augment_existing"
                    ? "Will update existing checklist item"
                    : "Will add to To-Do list"}
                </p>
                <p className="mt-1 font-mono text-sm text-slate-800">
                  - [ ] {omission.taskDescription}
                  {omission.deadline
                    ? ` (deadline: ${omission.deadline})`
                    : ""}
                </p>
              </div>
            </div>
          </label>
        </li>
      ))}
    </ul>
  );
}

export function OmissionsAnalysisDialog({
  open,
  analysis,
  loading,
  applyingMinutes,
  applyingTodos,
  error,
  warnings,
  finalized,
  minutesDivergesFromPdfSource,
  onClose,
  onStartCheck,
  onReRun,
  onApplyMinutes,
  onApplyTodos,
}: Props) {
  const [activeTab, setActiveTab] = useState<OmissionsTab>("minutes");
  const [selectedMinutesIds, setSelectedMinutesIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedTodosIds, setSelectedTodosIds] = useState<Set<string>>(
    new Set(),
  );

  const minutesOmissions = analysis?.omissions ?? [];
  const todosOmissions = analysis?.todosOmissions ?? [];
  const hasResults = analysis !== null && !loading;
  const applying = applyingMinutes || applyingTodos;

  useEffect(() => {
    if (open && minutesOmissions.length) {
      setSelectedMinutesIds(new Set(minutesOmissions.map((o) => o.id)));
    } else if (open) {
      setSelectedMinutesIds(new Set());
    }
  }, [open, analysis?.omissions]);

  useEffect(() => {
    if (open && todosOmissions.length) {
      setSelectedTodosIds(new Set(todosOmissions.map((o) => o.id)));
    } else if (open) {
      setSelectedTodosIds(new Set());
    }
  }, [open, analysis?.todosOmissions]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading && !applying) onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, loading, applying, onClose]);

  if (!open) return null;

  const hasMinutesOmissions = minutesOmissions.length > 0;
  const hasTodosOmissions = todosOmissions.length > 0;
  const selectedMinutesCount = minutesOmissions.filter((o) =>
    selectedMinutesIds.has(o.id),
  ).length;
  const selectedTodosCount = todosOmissions.filter((o) =>
    selectedTodosIds.has(o.id),
  ).length;
  const minutesMergeDisabled =
    finalized || applyingMinutes || loading || !hasMinutesOmissions;
  const todosMergeDisabled =
    finalized || applyingTodos || loading || !hasTodosOmissions;

  function toggleMinutesId(id: string) {
    setSelectedMinutesIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodosId(id: string) {
    setSelectedTodosIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applySelectedMinutes() {
    const selected = minutesOmissions.filter((o) =>
      selectedMinutesIds.has(o.id),
    );
    if (selected.length) onApplyMinutes(selected);
  }

  function applyAllMinutes() {
    setSelectedMinutesIds(new Set(minutesOmissions.map((o) => o.id)));
    onApplyMinutes(minutesOmissions);
  }

  function applySelectedTodos() {
    const selected = todosOmissions.filter((o) => selectedTodosIds.has(o.id));
    if (selected.length) onApplyTodos(selected);
  }

  function applyAllTodos() {
    setSelectedTodosIds(new Set(todosOmissions.map((o) => o.id)));
    onApplyTodos(todosOmissions);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={loading || applying ? undefined : onClose}
        aria-label="Close dialog"
        disabled={loading || applying}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="omissions-analysis-title"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2
            id="omissions-analysis-title"
            className="text-xl font-semibold text-slate-900"
          >
            Transcript omissions check
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Compares the meeting transcript against structured minutes (PDF
            source) and the To-Do list. Review findings in each tab and apply
            them separately.
          </p>
          {analysis?.analyzedAt ? (
            <p className="mt-2 text-xs text-slate-500">
              Last analyzed: {formatAnalyzedAt(analysis.analyzedAt)}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {minutesDivergesFromPdfSource && hasResults ? (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              Your edited markdown differs from structured JSON. Minutes
              omissions compare the transcript against structured JSON used for
              PDF export, not your free-form editor text.
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">Analysis warnings</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
              {error}
            </div>
          ) : null}

          {!hasResults && !loading && !error ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Run a dual check against the transcript: one pass for meeting
                minutes coverage and one for the To-Do list. Results appear in
                separate tabs when complete.
              </p>
              <button
                type="button"
                onClick={onStartCheck}
                disabled={loading || applying}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700 disabled:opacity-60"
              >
                Start omissions check
              </button>
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-slate-600">
              Analyzing transcript against minutes and To-Do list…
            </p>
          ) : null}

          {hasResults ? (
            <div className="space-y-4">
              <OmissionsTabStrip
                active={activeTab}
                onChange={setActiveTab}
                minutesCount={minutesOmissions.length}
                todosCount={todosOmissions.length}
              />

              {activeTab === "minutes" ? (
                <div role="tabpanel">
                  {!hasMinutesOmissions ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                      <p className="font-semibold">
                        No significant minutes omissions found
                      </p>
                      <p className="mt-1">
                        Structured minutes appear to cover substantive
                        transcript content.
                      </p>
                    </div>
                  ) : (
                    <MinutesOmissionsList
                      omissions={minutesOmissions}
                      selectedIds={selectedMinutesIds}
                      finalized={finalized}
                      applying={applyingMinutes}
                      onToggle={toggleMinutesId}
                    />
                  )}
                </div>
              ) : (
                <div role="tabpanel">
                  {!hasTodosOmissions ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                      <p className="font-semibold">
                        No significant To-Do list omissions found
                      </p>
                      <p className="mt-1">
                        The checklist appears to capture explicit assignments
                        and follow-ups from the transcript.
                      </p>
                    </div>
                  ) : (
                    <TodosOmissionsList
                      omissions={todosOmissions}
                      selectedIds={selectedTodosIds}
                      finalized={finalized}
                      applying={applyingTodos}
                      onToggle={toggleTodosId}
                    />
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-4">
          {hasResults ? (
            <button
              type="button"
              onClick={onReRun}
              disabled={loading || applying}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
            >
              {loading ? "Analyzing…" : "Re-run check"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading || applying}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
            >
              Close
            </button>

            {hasResults && activeTab === "minutes" && !finalized ? (
              <>
                {hasMinutesOmissions ? (
                  <>
                    <button
                      type="button"
                      onClick={applySelectedMinutes}
                      disabled={
                        minutesMergeDisabled || selectedMinutesCount === 0
                      }
                      className="rounded-md border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-900 hover:border-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {applyingMinutes
                        ? "Applying…"
                        : `Apply selected (${selectedMinutesCount})`}
                    </button>
                    <button
                      type="button"
                      onClick={applyAllMinutes}
                      disabled={minutesMergeDisabled}
                      className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {applyingMinutes ? "Applying…" : "Apply all minutes"}
                    </button>
                  </>
                ) : null}
              </>
            ) : null}

            {hasResults && activeTab === "todos" && !finalized ? (
              <>
                {hasTodosOmissions ? (
                  <>
                    <button
                      type="button"
                      onClick={applySelectedTodos}
                      disabled={todosMergeDisabled || selectedTodosCount === 0}
                      className="rounded-md border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-900 hover:border-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {applyingTodos
                        ? "Applying…"
                        : `Apply selected (${selectedTodosCount})`}
                    </button>
                    <button
                      type="button"
                      onClick={applyAllTodos}
                      disabled={todosMergeDisabled}
                      className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {applyingTodos ? "Applying…" : "Apply all to-dos"}
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
