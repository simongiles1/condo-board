"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  formatCostUsd,
  formatTokenCount,
  getLatestGoldStandardValidationRun,
  parseStoredAiUsage,
} from "@/lib/gemini/usage";
import {
  significanceChipClasses,
  significanceLabel,
  validationScoreBadgeClasses,
  validationScoreLabel,
  type CompareAlignment,
  type CompareTextMark,
  type GoldStandardValidationResult,
  type ValidationFinding,
} from "@/lib/minutes/gold-standard-schema";

type ValidationTab = "generatedOnly" | "goldOnly";

export type GoldStandardValidationTab = ValidationTab;

export type GoldStandardMeetingSummary = {
  id?: string;
  title: string;
  meetingDate?: string;
  aiUsageJson?: string | null;
  goldStandardFilePath?: string | null;
};

type Props = {
  meeting: GoldStandardMeetingSummary | null;
  validation: GoldStandardValidationResult | null;
  initialTab?: ValidationTab;
  focusAgendaItemId?: string | null;
  reCompareBusy?: boolean;
  onClose: () => void;
  onReCompare: () => void;
  onUploadDifferent?: () => void;
};

const MARK_CLASSES: Record<CompareTextMark, string> = {
  same: "text-slate-800",
  added: "bg-emerald-100 text-emerald-950",
  omitted: "bg-rose-100 text-rose-950",
  changed: "bg-amber-100 text-amber-950",
  motion: "bg-sky-100 text-sky-950",
  amount: "bg-violet-100 text-violet-950",
};

const MARK_LABELS: Record<CompareTextMark, string> = {
  same: "Same",
  added: "In AI only",
  omitted: "In gold only",
  changed: "Changed",
  motion: "Motion",
  amount: "Amount",
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

function alignmentChip(kind: CompareAlignment["kind"]): string {
  if (kind === "gold_only") return "bg-violet-100 text-violet-900";
  if (kind === "ai_only") return "bg-sky-100 text-sky-900";
  if (kind === "1:n" || kind === "n:1") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

function alignmentKindLabel(kind: CompareAlignment["kind"]): string {
  if (kind === "gold_only") return "Gold only";
  if (kind === "ai_only") return "AI only";
  if (kind === "1:n") return "Gold merged";
  if (kind === "n:1") return "Gold split";
  return "Matched";
}

function HighlightedProse({
  segments,
}: {
  segments: Array<{ text: string; mark: CompareTextMark }>;
}) {
  if (segments.length === 0) {
    return (
      <p className="text-sm italic text-slate-400">No counterpart on this side.</p>
    );
  }
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {segments.map((segment, index) => (
        <span
          key={`${index}-${segment.mark}`}
          className={`rounded-sm ${MARK_CLASSES[segment.mark]}`}
        >
          {segment.text}
        </span>
      ))}
    </p>
  );
}

function FindingsList({ findings }: { findings: ValidationFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {findings.map((finding) => (
        <li
          key={finding.id}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs font-semibold text-slate-900">{finding.topic}</p>
            <span
              className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${significanceChipClasses(finding.significance)}`}
            >
              {significanceLabel(finding.significance)}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">
            {finding.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function GoldStandardValidationSidePanel({
  meeting,
  validation,
  initialTab = "generatedOnly",
  focusAgendaItemId = null,
  reCompareBusy = false,
  onClose,
  onReCompare,
  onUploadDifferent,
}: Props) {
  const [differencesOnly, setDifferencesOnly] = useState(
    initialTab === "generatedOnly" || initialTab === "goldOnly",
  );
  const [activeAlignmentId, setActiveAlignmentId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!meeting || !validation) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [meeting, validation, onClose]);

  const compare = validation?.compare ?? null;
  const pairByAlignmentId = useMemo(() => {
    const map = new Map<string, NonNullable<typeof compare>["pairs"][number]>();
    if (!compare) return map;
    for (const pair of compare.pairs) {
      map.set(pair.alignmentId, pair);
    }
    return map;
  }, [compare]);

  const visibleAlignments = useMemo(() => {
    if (!compare) return [];
    if (!differencesOnly) return compare.alignments;
    return compare.alignments.filter((alignment) => {
      const pair = pairByAlignmentId.get(alignment.id);
      if (!pair) return alignment.kind === "gold_only" || alignment.kind === "ai_only";
      if (pair.findings.length > 0) return true;
      return pair.goldSegments.some((segment) => segment.mark !== "same") ||
        pair.aiSegments.some((segment) => segment.mark !== "same");
    });
  }, [compare, differencesOnly, pairByAlignmentId]);

  useEffect(() => {
    if (!compare) return;
    let nextId: string | null = null;
    if (focusAgendaItemId) {
      const match = compare.alignments.find((alignment) =>
        alignment.aiConceptIds.some((id) =>
          compare.aiConcepts
            .find((concept) => concept.id === id)
            ?.agendaItemIds.includes(focusAgendaItemId),
        ),
      );
      nextId = match?.id ?? null;
    }
    if (!nextId && initialTab === "goldOnly") {
      nextId =
        compare.alignments.find((alignment) => alignment.kind === "gold_only")
          ?.id ??
        compare.pairs.find((pair) =>
          pair.goldSegments.some((segment) => segment.mark === "omitted"),
        )?.alignmentId ??
        null;
    }
    if (!nextId && initialTab === "generatedOnly") {
      nextId =
        compare.alignments.find((alignment) => alignment.kind === "ai_only")
          ?.id ??
        compare.pairs.find((pair) =>
          pair.aiSegments.some((segment) => segment.mark === "added"),
        )?.alignmentId ??
        null;
    }
    setActiveAlignmentId(nextId ?? compare.alignments[0]?.id ?? null);
  }, [compare, focusAgendaItemId, initialTab]);

  useEffect(() => {
    if (!activeAlignmentId || !scrollRef.current) return;
    const node = scrollRef.current.querySelector(
      `[data-alignment-id="${activeAlignmentId}"]`,
    );
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [activeAlignmentId]);

  const costRun = useMemo(() => {
    if (!meeting?.aiUsageJson) return null;
    const log = parseStoredAiUsage(meeting.aiUsageJson);
    return getLatestGoldStandardValidationRun(log);
  }, [meeting?.aiUsageJson]);

  if (!meeting || !validation) return null;

  const generatedCount = validation.generatedOnly.length;
  const goldCount = validation.goldOnly.length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="min-w-0 text-lg font-semibold text-slate-900">
              Gold standard compare
            </h2>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ${validationScoreBadgeClasses(validation.validationScore)}`}
            >
              {validationScoreLabel(validation.validationScore)}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-800">{meeting.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Compared {formatAnalyzedAt(validation.analyzedAt)}
            {compare
              ? ` · ${compare.alignments.length} concepts`
              : ""}
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

      {compare ? (
        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 lg:block">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={differencesOnly}
                  onChange={(event) => setDifferencesOnly(event.target.checked)}
                />
                Differences only
              </label>
            </div>
            <ul className="p-2">
              {visibleAlignments.map((alignment) => {
                const pair = pairByAlignmentId.get(alignment.id);
                const selected = alignment.id === activeAlignmentId;
                return (
                  <li key={alignment.id}>
                    <button
                      type="button"
                      onClick={() => setActiveAlignmentId(alignment.id)}
                      className={`mb-1 w-full rounded-lg px-2.5 py-2 text-left transition ${
                        selected
                          ? "bg-white shadow-sm ring-1 ring-slate-200"
                          : "hover:bg-white/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-slate-900">
                          {alignment.label}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {pair ? `${pair.pairScore}%` : "—"}
                        </span>
                      </div>
                      <span
                        className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${alignmentChip(alignment.kind)}`}
                      >
                        {alignmentKindLabel(alignment.kind)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-slate-200 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500">
              <div className="border-r border-slate-200 px-4 py-2">
                Gold standard
              </div>
              <div className="px-4 py-2">AI minutes</div>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm leading-relaxed text-slate-700">
                {validation.scoreRationale}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {(Object.keys(MARK_LABELS) as CompareTextMark[]).map((mark) => (
                  <span
                    key={mark}
                    className={`rounded px-1.5 py-0.5 font-medium ${MARK_CLASSES[mark]}`}
                  >
                    {MARK_LABELS[mark]}
                  </span>
                ))}
              </div>
            </div>
            {visibleAlignments.map((alignment) => {
              const pair = pairByAlignmentId.get(alignment.id);
              return (
                <section
                  key={alignment.id}
                  data-alignment-id={alignment.id}
                  className={`border-t border-slate-200 ${
                    alignment.id === activeAlignmentId ? "bg-teal-50/30" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {alignment.label}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${alignmentChip(alignment.kind)}`}
                      >
                        {alignmentKindLabel(alignment.kind)}
                      </span>
                      {pair ? (
                        <span className="font-mono text-xs text-slate-500">
                          {pair.pairScore}%
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2">
                    <div className="border-b border-slate-100 px-4 py-3 md:border-b-0 md:border-r">
                      <HighlightedProse segments={pair?.goldSegments ?? []} />
                    </div>
                    <div className="px-4 py-3">
                      <HighlightedProse segments={pair?.aiSegments ?? []} />
                    </div>
                  </div>
                  {pair ? (
                    <div className="px-4 pb-4">
                      <FindingsList findings={pair.findings} />
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Score rationale
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-800">
              {validation.scoreRationale}
            </p>
          </section>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                In AI only ({generatedCount})
              </h3>
              <FindingsList findings={validation.generatedOnly} />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                In gold only ({goldCount})
              </h3>
              <FindingsList findings={validation.goldOnly} />
            </section>
          </div>
        </div>
      )}

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
        <div className="text-xs text-slate-500">
          {costRun ? (
            <span>
              {formatTokenCount(costRun.inputTokens)} in /{" "}
              {formatTokenCount(costRun.outputTokens)} out · {costRun.modelName} ·{" "}
              <span className="font-semibold text-teal-800">
                {formatCostUsd(costRun.costUsd)}
              </span>
            </span>
          ) : (
            "Cost details are not available for this run."
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {onUploadDifferent ? (
            <button
              type="button"
              onClick={onUploadDifferent}
              disabled={reCompareBusy}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
            >
              Upload different PDF
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReCompare}
            disabled={reCompareBusy}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
          >
            {reCompareBusy ? "Re-comparing…" : "Re-compare"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-800"
          >
            Close
          </button>
        </div>
      </footer>
    </div>
  );
}
