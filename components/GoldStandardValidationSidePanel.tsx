"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatCostUsd,
  formatTokenCount,
  getLatestGoldStandardValidationRun,
  parseStoredAiUsage,
} from "@/lib/gemini/usage";
import type { Meeting } from "@/lib/db/types";
import {
  significanceChipClasses,
  significanceLabel,
  validationScoreBadgeClasses,
  validationScoreLabel,
  type GoldStandardValidationResult,
  type ValidationFinding,
} from "@/lib/minutes/gold-standard-schema";

type ValidationTab = "generatedOnly" | "goldOnly";

type Props = {
  meeting: Meeting | null;
  validation: GoldStandardValidationResult | null;
  onClose: () => void;
  onReCompare: () => void;
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

function ValidationTabStrip({
  active,
  onChange,
  generatedCount,
  goldCount,
}: {
  active: ValidationTab;
  onChange: (tab: ValidationTab) => void;
  generatedCount: number;
  goldCount: number;
}) {
  const tabs: { id: ValidationTab; label: string; count: number }[] = [
    { id: "generatedOnly", label: "In AI only", count: generatedCount },
    { id: "goldOnly", label: "In gold only", count: goldCount },
  ];

  return (
    <div
      className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label="Validation diff sections"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
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

function FindingsList({ findings }: { findings: ValidationFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        No findings in this category.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {findings.map((finding) => (
        <li
          key={finding.id}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {finding.topic}
            </h3>
            <span
              className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${significanceChipClasses(finding.significance)}`}
            >
              {significanceLabel(finding.significance)}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            {finding.detail}
          </p>
          {finding.section ? (
            <p className="mt-2 text-xs text-slate-500">
              Section: {finding.section}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function GoldStandardValidationSidePanel({
  meeting,
  validation,
  onClose,
  onReCompare,
}: Props) {
  const [activeTab, setActiveTab] = useState<ValidationTab>("generatedOnly");

  useEffect(() => {
    if (!meeting) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [meeting, onClose]);

  const costRun = useMemo(() => {
    if (!meeting?.aiUsageJson) return null;
    const log = parseStoredAiUsage(meeting.aiUsageJson);
    return getLatestGoldStandardValidationRun(log);
  }, [meeting?.aiUsageJson]);

  if (!meeting || !validation) return null;

  const generatedCount = validation.generatedOnly.length;
  const goldCount = validation.goldOnly.length;
  const activeFindings =
    activeTab === "generatedOnly"
      ? validation.generatedOnly
      : validation.goldOnly;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/25"
        onClick={onClose}
        aria-label="Close validation panel"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="gold-standard-panel-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-4xl flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2
                id="gold-standard-panel-title"
                className="min-w-0 text-lg font-semibold text-slate-900"
              >
                Gold standard validation
              </h2>
              <span
                className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ${validationScoreBadgeClasses(validation.validationScore)}`}
              >
                {validationScoreLabel(validation.validationScore)}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-slate-800">
              {meeting.title}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Compared {formatAnalyzedAt(validation.analyzedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Score rationale
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-800">
                {validation.scoreRationale}
              </p>
            </section>

            {validation.noSignificantDifferences &&
            generatedCount === 0 &&
            goldCount === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                No significant content differences found.
              </div>
            ) : null}

            <ValidationTabStrip
              active={activeTab}
              onChange={setActiveTab}
              generatedCount={generatedCount}
              goldCount={goldCount}
            />

            <FindingsList findings={activeFindings} />

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Comparison cost
              </h3>
              {costRun ? (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-slate-500">Input tokens</dt>
                    <dd className="font-mono text-slate-900">
                      {formatTokenCount(costRun.inputTokens)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Output tokens</dt>
                    <dd className="font-mono text-slate-900">
                      {formatTokenCount(costRun.outputTokens)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Model</dt>
                    <dd className="truncate text-slate-900" title={costRun.modelName}>
                      {costRun.modelName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Estimated cost</dt>
                    <dd className="font-mono font-semibold text-teal-800">
                      {formatCostUsd(costRun.costUsd)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  Cost details are not available for this run.
                </p>
              )}
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onReCompare}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Re-compare
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-800"
          >
            Close
          </button>
        </footer>
      </aside>
    </>
  );
}
