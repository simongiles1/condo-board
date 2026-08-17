"use client";

import { useEffect, useId, useState } from "react";

import { BuildoutIcon } from "@/components/nav-icons";
import {
  BUILDOUT_BACKLOG,
  BUILDOUT_COVERAGE_SNAPSHOT,
  BUILDOUT_REVIEWED_ON,
  BUILDOUT_SEQUENCE,
  BUILDOUT_SEQUENCE_KIND_LABEL,
  BUILDOUT_STAGES,
  BUILDOUT_STATUS_LABEL,
  buildoutItemById,
  countByStatus,
  type BuildoutItem,
  type BuildoutSequenceKind,
  type BuildoutSequenceStep,
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

const SEQUENCE_PILL: Record<BuildoutSequenceKind, string> = {
  now: "bg-teal-50 text-teal-800 ring-teal-200",
  parallel: "bg-amber-50 text-amber-900 ring-amber-200",
  blocked: "bg-rose-50 text-rose-800 ring-rose-200",
  after: "bg-sky-50 text-sky-900 ring-sky-200",
  later: "bg-violet-50 text-violet-900 ring-violet-200",
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
  const stageCounts = countByStatus(BUILDOUT_STAGES);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(90dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700/80">
                Dev Tools
              </p>
              <h2
                id={titleId}
                className="mt-1 text-xl font-semibold text-slate-900"
              >
                Build-out progress
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Do-next playbook, then stage inventory. Reviewed{" "}
                {BUILDOUT_REVIEWED_ON}. Live coverage stays on the extraction
                calendar.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <StageMeter counts={stageCounts} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <SectionHeading>What to do next</SectionHeading>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            Snapshot {BUILDOUT_COVERAGE_SNAPSHOT.asOf}: contacts{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.contactsExtracted)} /{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.emails)}
            {" · "}orgs {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.orgsExtracted)}
            {" · "}events{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.eventsExtracted)}
            {" · "}to-dos{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.todosExtracted)} /{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.emails)}. Vision{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.visionPagesDone)} /{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.visionPagesTotal)} pages (
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.visionPagesRemaining)} left,{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.visionSpendCapFailed)} spend
            cap). Stage 2B:{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.affiliationsPending)} pending,{" "}
            {formatCount(BUILDOUT_COVERAGE_SNAPSHOT.affiliationsApproved)}{" "}
            approved.
          </p>
          <ol className="space-y-3">
            {BUILDOUT_SEQUENCE.map((step, index) => (
              <li key={step.id}>
                <SequenceStepCard step={step} index={index + 1} />
              </li>
            ))}
          </ol>

          <SectionHeading className="mt-8">Extraction stages</SectionHeading>
          <ul className="space-y-3">
            {BUILDOUT_STAGES.map((item) => (
              <li key={item.id}>
                <BuildoutCard item={item} />
              </li>
            ))}
          </ul>

          <SectionHeading className="mt-8">Still ahead</SectionHeading>
          <ul className="space-y-3">
            {BUILDOUT_BACKLOG.map((item) => (
              <li key={item.id}>
                <BuildoutCard item={item} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <h3
      className={`mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${className}`}
    >
      {children}
    </h3>
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
    <div className="mt-4">
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
        {" of "}
        {total} harvest stages
      </p>
    </div>
  );
}

function relatedItemLabel(id: string): string {
  const item = buildoutItemById(id);
  if (!item) return id;
  return item.stage ? `Stage ${item.stage}` : item.title;
}

function SequenceStepCard({
  step,
  index,
}: {
  step: BuildoutSequenceStep;
  index: number;
}) {
  return (
    <article className="rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-semibold tabular-nums text-amber-900">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900">
              {step.title}
            </h4>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${SEQUENCE_PILL[step.kind]}`}
            >
              {BUILDOUT_SEQUENCE_KIND_LABEL[step.kind]}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{step.detail}</p>
          {step.relatedIds.length > 0 ? (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {step.relatedIds.map((id) => (
                <span
                  key={id}
                  className="rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200"
                >
                  {relatedItemLabel(id)}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function BuildoutCard({ item }: { item: BuildoutItem }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {item.stage ? (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Stage {item.stage}
              </span>
            ) : null}
            <h4 className="text-sm font-semibold text-slate-900">
              {item.title}
            </h4>
          </div>
          <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_PILL[item.status]}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[item.status]}`}
          />
          {BUILDOUT_STATUS_LABEL[item.status]}
        </span>
      </div>
      {item.remaining.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 border-t border-slate-200/80 pt-2 pl-4">
          {item.remaining.map((line) => (
            <li key={line} className="text-xs leading-relaxed text-slate-500">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
