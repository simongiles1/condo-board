"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { BuildoutIcon } from "@/components/nav-icons";
import {
  BUILDOUT_COVERAGE_SNAPSHOT,
  BUILDOUT_GANTT_PHASE_ORDER,
  BUILDOUT_REVIEWED_ON,
  BUILDOUT_SEQUENCE_KIND_LABEL,
  BUILDOUT_STAGES,
  BUILDOUT_STATUS_LABEL,
  buildoutGanttRows,
  countByStatus,
  type BuildoutGanttRow,
  type BuildoutSequenceKind,
  type BuildoutStatus,
} from "@/lib/buildout/progress";

const STATUS_PILL: Record<BuildoutStatus, string> = {
  done: "bg-teal-50 text-teal-800 ring-teal-200",
  in_progress: "bg-amber-50 text-amber-900 ring-amber-200",
  not_started: "bg-slate-100 text-slate-700 ring-slate-200",
  deferred: "bg-violet-50 text-violet-900 ring-violet-200",
};

const STATUS_DOT: Record<BuildoutStatus, string> = {
  done: "bg-teal-600",
  in_progress: "bg-amber-500",
  not_started: "bg-slate-400",
  deferred: "bg-violet-500",
};

const STATUS_BAR: Record<BuildoutStatus, string> = {
  done: "bg-teal-500/85",
  in_progress: "bg-amber-400/90",
  not_started: "bg-slate-300/90",
  deferred: "bg-violet-400/85",
};

const SEQUENCE_PILL: Record<BuildoutSequenceKind, string> = {
  now: "bg-teal-50 text-teal-800 ring-teal-200",
  parallel: "bg-amber-50 text-amber-900 ring-amber-200",
  blocked: "bg-rose-50 text-rose-800 ring-rose-200",
  after: "bg-sky-50 text-sky-900 ring-sky-200",
  later: "bg-violet-50 text-violet-900 ring-violet-200",
  deferred: "bg-slate-100 text-slate-700 ring-slate-200",
};

const PHASE_HEADER: Record<BuildoutSequenceKind, string> = {
  now: "bg-teal-50/80 text-teal-900",
  parallel: "bg-amber-50/80 text-amber-950",
  blocked: "bg-rose-50/80 text-rose-950",
  after: "bg-sky-50/80 text-sky-950",
  later: "bg-violet-50/80 text-violet-950",
  deferred: "bg-slate-100/90 text-slate-800",
};

const PHASE_COLUMN: Record<BuildoutSequenceKind, string> = {
  now: "bg-teal-50/25",
  parallel: "bg-amber-50/20",
  blocked: "bg-rose-50/20",
  after: "bg-sky-50/20",
  later: "bg-violet-50/15",
  deferred: "bg-slate-50/80",
};

const PLAYBOOK_BAR: Record<BuildoutSequenceKind, string> = {
  now: "bg-teal-500/85",
  parallel: "bg-amber-400/90",
  blocked: "bg-rose-400/90",
  after: "bg-sky-400/90",
  later: "bg-violet-400/85",
  deferred: "bg-slate-400/90",
};

function formatCount(value: number): string {
  return value.toLocaleString("en-CA");
}

export function BuildoutProgressButton({
  collapsed,
}: {
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const stageCounts = countByStatus(BUILDOUT_STAGES);
  const doneLabel = `${stageCounts.done}/${BUILDOUT_STAGES.length}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Build-out progress"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={
          collapsed
            ? "relative flex h-10 w-10 items-center justify-center rounded-lg text-amber-800/80 transition hover:bg-amber-50 hover:text-amber-950"
            : "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-amber-900/80 hover:bg-amber-50 hover:text-amber-950"
        }
      >
        <BuildoutIcon className="h-5 w-5 shrink-0" />
        {collapsed ? (
          <span className="sr-only">Build-out progress</span>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-left">
              Build-out
            </span>
            <span className="tabular-nums text-[11px] font-semibold text-amber-800/70">
              {doneLabel}
            </span>
          </>
        )}
      </button>
      <BuildoutProgressDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function BuildoutProgressDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const stageCounts = countByStatus(BUILDOUT_STAGES);
  const gantt = useMemo(() => buildoutGanttRows(), []);
  const defaultSelection = gantt.playbook[0]?.id ?? gantt.stages[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(defaultSelection);

  const allRows = useMemo(
    () => [...gantt.playbook, ...gantt.stages, ...gantt.backlog],
    [gantt],
  );
  const selected =
    allRows.find((row) => row.id === selectedId) ?? gantt.playbook[0] ?? null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(defaultSelection);
  }, [open, defaultSelection]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-start gap-3">
            <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              Dev Tools
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="text-sm font-semibold text-slate-900 sm:text-base"
              >
                Build-out progress
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                Execution timeline and harvest inventory. Reviewed{" "}
                {BUILDOUT_REVIEWED_ON}. Live coverage stays on the extraction
                calendar.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              aria-label="Close"
            >
              Close
            </button>
          </div>
          <StageMeter counts={stageCounts} />
          <CoverageSnapshot />
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 flex-1 overflow-hidden border-b border-slate-200 lg:border-b-0 lg:border-r">
            <BuildoutGanttChart
              gantt={gantt}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
          </div>

          <aside className="flex w-full shrink-0 flex-col bg-slate-50/70 lg:w-[22rem] xl:w-[26rem]">
            <div className="border-b border-slate-200/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Details
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {selected ? (
                <GanttDetailPanel row={selected} />
              ) : (
                <p className="text-sm text-slate-500">
                  Select a row in the timeline to read the summary and remaining
                  work.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CoverageSnapshot() {
  return (
    <p className="mt-3 text-xs leading-relaxed text-slate-500">
      Snapshot {BUILDOUT_COVERAGE_SNAPSHOT.asOf}: contacts{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.contactsExtracted)} /{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.emails)}
      {" · "}orgs {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.orgsExtracted)}
      {" · "}events {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.eventsExtracted)}
      {" · "}to-dos {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.todosExtracted)} /{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.emails)}
      {" · "}projects{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.projectsExtracted)} /{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.emails)}. Vision{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.visionPagesDone)} /{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.visionPagesTotal)} pages (
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.visionPagesRemaining)} left,{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.visionSpendCapFailed)} spend cap).
      Stage 2B:{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.affiliationsPending)} pending,{" "}
      {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.affiliationsApproved)} approved.
    </p>
  );
}

function BuildoutGanttChart({
  gantt,
  selectedId,
  onSelect,
}: {
  gantt: ReturnType<typeof buildoutGanttRows>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const labelWidth = "minmax(18rem, 28rem)";
  const allRows = [...gantt.playbook, ...gantt.stages, ...gantt.backlog];
  const activePhases = BUILDOUT_GANTT_PHASE_ORDER.filter((phase) =>
    allRows.some((row) => row.phases.includes(phase)),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-slate-100 bg-white px-3 py-2 sm:px-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Execution timeline
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="grid min-w-full"
          style={{
            gridTemplateColumns: `${labelWidth} repeat(${activePhases.length}, minmax(6rem, 1fr))`,
          }}
        >
          <div className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Workstream
          </div>
          {activePhases.map((phase) => (
            <div
              key={phase}
              className={`sticky top-0 z-10 border-b border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide ${PHASE_HEADER[phase]}`}
            >
              {BUILDOUT_SEQUENCE_KIND_LABEL[phase]}
            </div>
          ))}

          <GanttSectionHeading label="What to do next" />
          {gantt.playbook.map((row) => (
            <GanttRow
              key={row.id}
              row={row}
              phases={activePhases}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}

          <GanttSectionHeading label="Extraction stages" />
          {gantt.stages.map((row) => (
            <GanttRow
              key={row.id}
              row={row}
              phases={activePhases}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}

          <GanttSectionHeading label="Still ahead" />
          {gantt.backlog.map((row) => (
            <GanttRow
              key={row.id}
              row={row}
              phases={activePhases}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GanttSectionHeading({ label }: { label: string }) {
  return (
    <div
      className="sticky left-0 z-10 col-span-full border-y border-slate-200 bg-slate-100/90 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
      style={{ gridColumn: "1 / -1" }}
    >
      {label}
    </div>
  );
}

function GanttRow({
  row,
  phases,
  selected,
  onSelect,
}: {
  row: BuildoutGanttRow;
  phases: readonly BuildoutSequenceKind[];
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const phaseSet = new Set(row.phases);

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        className={`sticky left-0 z-10 flex min-h-[2.35rem] items-center gap-2 border-b border-r border-slate-200 px-3 py-1.5 text-left transition ${
          selected
            ? "bg-amber-50 ring-1 ring-inset ring-amber-200"
            : "bg-white hover:bg-slate-50"
        }`}
      >
        {row.sequenceOrder ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-semibold tabular-nums text-amber-900">
            {row.sequenceOrder}
          </span>
        ) : row.status ? (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[row.status]}`}
          />
        ) : null}
        <span className="min-w-0">
          <span className="block text-xs font-semibold leading-snug text-slate-900">
            {row.label}
          </span>
          {row.subtitle ? (
            <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
              {row.subtitle}
            </span>
          ) : null}
        </span>
      </button>

      {phases.map((phase) => (
        <div
          key={`${row.id}-${phase}`}
          className={`relative min-h-[2.35rem] border-b border-slate-200 ${PHASE_COLUMN[phase]} ${
            selected ? "bg-amber-50/40" : ""
          }`}
        >
          {phaseSet.has(phase) ? (
            <div className="absolute inset-x-1.5 inset-y-2 flex items-center">
              {row.rowKind === "playbook" ? (
                <div
                  className={`h-2.5 w-full rounded-full shadow-sm ring-1 ring-inset ring-white/60 ${PLAYBOOK_BAR[phase]}`}
                  title={row.label}
                />
              ) : row.status ? (
                <div
                  className={`h-2.5 w-full rounded-full shadow-sm ring-1 ring-inset ring-white/50 ${STATUS_BAR[row.status]}`}
                  title={`${row.label} · ${BUILDOUT_STATUS_LABEL[row.status]}`}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

function GanttDetailPanel({ row }: { row: BuildoutGanttRow }) {
  return (
    <article className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {row.sequenceOrder ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
              Step {row.sequenceOrder}
            </span>
          ) : null}
          {row.subtitle ? (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {row.subtitle}
            </span>
          ) : null}
          {row.status ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_PILL[row.status]}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[row.status]}`}
              />
              {BUILDOUT_STATUS_LABEL[row.status]}
            </span>
          ) : null}
        </div>
        <h3 className="mt-2 text-base font-semibold text-slate-900">
          {row.label}
        </h3>
        {row.phases.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {row.phases.map((phase) => (
              <span
                key={phase}
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${SEQUENCE_PILL[phase]}`}
              >
                {BUILDOUT_SEQUENCE_KIND_LABEL[phase]}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-slate-600">{row.summary}</p>

      {row.remaining.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {row.rowKind === "playbook" ? "Related work" : "Remaining"}
          </p>
          <ul className="list-disc space-y-1.5 pl-4">
            {row.remaining.map((line) => (
              <li key={line} className="text-xs leading-relaxed text-slate-500">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function StageMeter({
  counts,
}: {
  counts: Record<BuildoutStatus, number>;
}) {
  const total = BUILDOUT_STAGES.length;
  const segments: { status: BuildoutStatus; className: string }[] = [
    { status: "done", className: "bg-teal-600" },
    { status: "in_progress", className: "bg-amber-400" },
    { status: "not_started", className: "bg-slate-300" },
    { status: "deferred", className: "bg-violet-400" },
  ];

  return (
    <div className="mt-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
        {segments.map((segment) => {
          const value = counts[segment.status];
          if (value === 0) return null;
          return (
            <div
              key={segment.status}
              className={segment.className}
              style={{ width: `${(value / total) * 100}%` }}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        <span className="font-medium text-teal-800">{counts.done} done</span>
        {" · "}
        <span className="font-medium text-amber-800">
          {counts.in_progress} in progress
        </span>
        {" · "}
        <span className="font-medium text-slate-600">
          {counts.not_started} not started
        </span>
        {counts.deferred > 0 ? (
          <>
            {" · "}
            <span className="font-medium text-violet-800">
              {counts.deferred} parked
            </span>
          </>
        ) : null}
        {" of "}
        {total} harvest stages
      </p>
    </div>
  );
}
