"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  SECTION_BORDER_COLORS,
  speakerBackgroundColor,
} from "@/components/ReadableTranscriptView";
import type { MergedVttCue } from "@/lib/parsers/vtt";
import { formatVttTimestamp } from "@/lib/parsers/vtt";
import {
  cellCostLabel,
  cellRunningCostDisplay,
  type SegmentCompareCostBaseline,
} from "@/lib/meeting-v2/segment-compare-cost-estimates";
import {
  formatSegmentCompareCombination,
  SAVED_AGENDA_COMPARE_ID,
  SAVED_EXTRACT_COMBINATION_KEY,
  SEGMENT_COMPARE_MATRIX_CELL_COUNT,
  segmentCompareCombinationKey,
  segmentCompareMatrixSlots,
  segmentCompareSlotShortLabel,
  type SegmentCompareRun,
  type SegmentCompareSlotChoice,
} from "@/lib/meeting-v2/segment-compare-models";
import {
  cueSeconds,
  formatGoldScorePercent,
  GOLD_STANDARD_COMPARE_ID,
  goldCueIndexFromBoxes,
  goldResizeHandlesAtCue,
  addGoldSpanReplacingOverlaps,
  buildGoldLabelCueSegmentMeta,
  findGoldSpanForEdge,
  goldCueCoverageForSpan,
  goldSpanFromCueIndexRange,
  goldSpanBorderRoleAtIndex,
  mergeGoldSpans,
  resolveGoldSpanCueIndices,
  overlaysFromGoldSpans,
  scoreOverlaysAgainstGold,
  type AgendaConceptRow,
  type GoldResizeHandles,
  type GoldSpanBorderRole,
  type SegmentGoldSpan,
  type SegmentGoldStandard,
} from "@/lib/meeting-v2/segment-gold-standard";
import {
  groupCuesByTranscriptSections,
  type TranscriptSectionOverlay,
} from "@/lib/transcript/section-overlay";
import { GoldStandardPipelineConfirmDialog } from "@/components/GoldStandardPipelineConfirmDialog";
import { GoldStandardTranscriptMinimap } from "@/components/GoldStandardTranscriptMinimap";
import { SegmentCompareRunConfirmDialog } from "@/components/SegmentCompareRunConfirmDialog";

type WorkspacePayload = {
  cues: MergedVttCue[];
  savedOverlays: TranscriptSectionOverlay[];
  runs: SegmentCompareRun[];
  agendaItemCount: number;
  costBaseline: SegmentCompareCostBaseline | null;
  agendaConcepts: AgendaConceptRow[];
  goldStandard: SegmentGoldStandard | null;
  goldOverlays: TranscriptSectionOverlay[];
};

type CombinationRow = {
  key: string;
  walk: SegmentCompareSlotChoice;
  edge: SegmentCompareSlotChoice;
};

type Props = {
  open: boolean;
  meetingId: string;
  onClose: () => void;
};

const DEFAULT_WALK: SegmentCompareSlotChoice = {
  modelId: "deepseek-v4-flash",
  thinking: false,
};

const DEFAULT_EDGE: SegmentCompareSlotChoice = {
  modelId: "deepseek-v4-flash",
  thinking: false,
};

const DEFAULT_RUN_TARGET_KEY = segmentCompareCombinationKey(DEFAULT_WALK, DEFAULT_EDGE);

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function runLabel(run: SegmentCompareRun): string {
  return formatSegmentCompareCombination(run.walk, run.edge);
}

/** Matrix cells: stage + step only (model names live in row/column headers). */
function compactMatrixProgressLabel(label: string | null | undefined): string {
  if (!label) return "Running…";
  if (/^(Walk|Edge) \d+\/\d+$/.test(label)) return label;
  const walkLegacy = label.match(/Walk .+ · chunk (\d+)\/(\d+)/);
  if (walkLegacy) return `Walk ${walkLegacy[1]}/${walkLegacy[2]}`;
  if (label === "Loading stored agenda outline" || label === "Loading") return "Loading";
  if (label === "Queued") return "Queued";
  return label;
}

function latestCompletedRunForKey(
  runs: SegmentCompareRun[],
  key: string,
): SegmentCompareRun | null {
  const matches = runs.filter(
    (run) =>
      run.status === "completed" &&
      segmentCompareCombinationKey(run.walk, run.edge) === key,
  );
  return matches[matches.length - 1] ?? null;
}

function latestRunForKey(runs: SegmentCompareRun[], key: string): SegmentCompareRun | null {
  const matches = runs.filter(
    (run) => segmentCompareCombinationKey(run.walk, run.edge) === key,
  );
  return matches[matches.length - 1] ?? null;
}

function defaultGoldReferencePaneId(runs: SegmentCompareRun[]): string {
  const completed = runs.filter((run) => run.status === "completed");
  const latest = completed[completed.length - 1];
  return latest?.id ?? SAVED_AGENDA_COMPARE_ID;
}

function normalizePaneRunId(paneId: string, runs: SegmentCompareRun[]): string {
  if (paneId === SAVED_AGENDA_COMPARE_ID || paneId === GOLD_STANDARD_COMPARE_ID) return paneId;
  const run = runs.find((entry) => entry.id === paneId);
  return run?.status === "completed" ? paneId : SAVED_AGENDA_COMPARE_ID;
}

function describeFetchError(caught: unknown): string {
  if (caught instanceof TypeError && caught.message === "Failed to fetch") {
    return "Lost connection to the server while checking lab status. The run may still have finished—use Refresh status or reopen this dialog.";
  }
  return caught instanceof Error ? caught.message : String(caught);
}

function buildCombinationRows(): CombinationRow[] {
  const slots = segmentCompareMatrixSlots();
  const rows: CombinationRow[] = [];
  for (const walk of slots) {
    for (const edge of slots) {
      rows.push({
        key: segmentCompareCombinationKey(walk, edge),
        walk,
        edge,
      });
    }
  }
  return rows;
}

function countCompletedLabCombinations(runs: SegmentCompareRun[]): number {
  const keys = new Set<string>();
  for (const run of runs) {
    if (run.status !== "completed") continue;
    keys.add(segmentCompareCombinationKey(run.walk, run.edge));
  }
  return keys.size;
}

function paneIdForCombination(key: string, runs: SegmentCompareRun[]): string | null {
  const completed = latestCompletedRunForKey(runs, key);
  if (completed) return completed.id;
  if (key === SAVED_EXTRACT_COMBINATION_KEY) return SAVED_AGENDA_COMPARE_ID;
  return null;
}

const SAVED_EXTRACT_WALK: SegmentCompareSlotChoice = {
  modelId: "deepseek-v4-flash",
  thinking: false,
};

const SAVED_EXTRACT_EDGE: SegmentCompareSlotChoice = {
  modelId: "deepseek-v4-flash",
  thinking: false,
};

function paneCombination(
  paneId: string,
  runs: SegmentCompareRun[],
): { walk: SegmentCompareSlotChoice; edge: SegmentCompareSlotChoice } | null {
  if (paneId === GOLD_STANDARD_COMPARE_ID) return null;
  if (paneId === SAVED_AGENDA_COMPARE_ID) {
    return { walk: SAVED_EXTRACT_WALK, edge: SAVED_EXTRACT_EDGE };
  }
  const run = runs.find((entry) => entry.id === paneId);
  if (!run) {
    return { walk: SAVED_EXTRACT_WALK, edge: SAVED_EXTRACT_EDGE };
  }
  return { walk: run.walk, edge: run.edge };
}

function MatrixEditIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        d="M15.98 2.22a2.25 2.25 0 012.83 2.83l-9.4 9.4a2 2 0 01-.878.506l-3.84 1.067a.5.5 0 01-.62-.62l1.067-3.84a2 2 0 01.506-.878l9.4-9.4zM4.5 13.5l1.06 1.06M13.94 4.06l1.06 1.06"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function ComparePaneColumnHeader({
  paneId,
  runs,
  onEdit,
}: {
  paneId: string;
  runs: SegmentCompareRun[];
  onEdit: () => void;
}) {
  const combination = paneCombination(paneId, runs);

  return (
    <div
      className="flex items-start gap-2 border-b border-slate-200 bg-white px-3 py-2.5 shadow-[0_1px_0_0_rgba(15,23,42,0.06)]"
    >
      <div className="min-w-0 flex-1">
        {combination ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-sm text-slate-900">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Walk
              </span>
              <span className="ml-1.5 font-semibold">{segmentCompareSlotShortLabel(combination.walk)}</span>
            </span>
            <span className="text-sm text-slate-900">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Edge
              </span>
              <span className="ml-1.5 font-semibold">{segmentCompareSlotShortLabel(combination.edge)}</span>
            </span>
          </div>
        ) : (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
              Gold standard
            </p>
            <p className="text-sm font-semibold text-slate-900">Human transcript spans</p>
          </div>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        aria-label="Change combinations (walk × edge matrix)"
        onClick={onEdit}
      >
        <MatrixEditIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function GoldLabelColumnHeader({
  selectedConcept,
  pendingStartIndex,
  selectedConceptHasSpan,
}: {
  selectedConcept: AgendaConceptRow | null;
  pendingStartIndex: number | null;
  selectedConceptHasSpan: boolean;
}) {
  return (
    <div
      className="flex items-start gap-2 border-b border-slate-200 bg-white px-3 py-2.5 shadow-[0_1px_0_0_rgba(15,23,42,0.06)]"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
          Gold standard
        </p>
        <p className="text-sm text-slate-700">
          {selectedConcept
            ? pendingStartIndex == null
              ? selectedConceptHasSpan
                ? `Drag the top or bottom edge of ${selectedConcept.code}. Hover an edge to see which span it belongs to. Click a cue to replace the span — including inside another item.`
                : `Click the start of ${selectedConcept.code} — ${selectedConcept.title}. You can start inside another item's span.`
              : `Click the end of ${selectedConcept.code} — ${selectedConcept.title}`
            : "Select a concept, then mark start and end cues."}
        </p>
      </div>
    </div>
  );
}

function CompareCombinationMatrix({
  runs,
  costBaseline,
  runTargetKey,
  leftId,
  rightId,
  onRunTargetChange,
  onLeftChange,
  onRightChange,
  onDeleteRun,
  onError,
  goldOverlays,
  savedOverlays,
}: {
  runs: SegmentCompareRun[];
  costBaseline: SegmentCompareCostBaseline | null;
  runTargetKey: string;
  leftId: string;
  rightId: string;
  onRunTargetChange: (key: string, row: CombinationRow) => void;
  onLeftChange: (paneId: string) => void;
  onRightChange: (paneId: string) => void;
  onDeleteRun: (runId: string) => void;
  onError: (message: string) => void;
  goldOverlays: TranscriptSectionOverlay[];
  savedOverlays: TranscriptSectionOverlay[];
}) {
  const matrixSlots = useMemo(() => segmentCompareMatrixSlots(), []);
  const activeRuns = runs.filter((run) => run.status !== "completed");

  function assignPane(side: "left" | "right", paneId: string) {
    if (side === "left") onLeftChange(paneId);
    else onRightChange(paneId);
  }

  function assignCombination(side: "left" | "right", key: string) {
    const latest = latestRunForKey(runs, key);
    if (latest?.status === "failed") {
      onError(latest.error || "This lab run failed. Remove it below and try again.");
      return;
    }
    if (latest && (latest.status === "queued" || latest.status === "running")) {
      onError("Wait for the lab run to finish before assigning this cell to a pane.");
      return;
    }
    const paneId = paneIdForCombination(key, runs);
    if (!paneId) {
      onError("Run this combination in the lab first, or use the V4 × V4 cell for the saved extract.");
      return;
    }
    assignPane(side, paneId);
  }

  function paneToggleHint(key: string, side: "left" | "right", label: string): string {
    const latest = latestRunForKey(runs, key);
    if (latest?.status === "failed") {
      return latest.error || "Lab run failed — remove it and retry.";
    }
    if (latest && (latest.status === "queued" || latest.status === "running")) {
      return "Lab run in progress…";
    }
    if (!paneIdForCombination(key, runs)) {
      return "Run this combination in the lab first, or use V4 × V4 for the saved extract.";
    }
    return `${side === "left" ? "Left" : "Right"} pane: ${label}`;
  }

  function paneActive(paneId: string, side: "left" | "right"): boolean {
    return side === "left" ? leftId === paneId : rightId === paneId;
  }

  function combinationPaneActive(key: string, side: "left" | "right"): boolean {
    const paneId = paneIdForCombination(key, runs);
    if (!paneId) return false;
    return paneActive(paneId, side);
  }

  function combinationRow(walk: SegmentCompareSlotChoice, edge: SegmentCompareSlotChoice): CombinationRow {
    return {
      key: segmentCompareCombinationKey(walk, edge),
      walk,
      edge,
    };
  }

  return (
    <>
          <p className="mb-3 text-xs leading-relaxed text-slate-600">
            Rows = walk model (plain + <span className="font-semibold">· think</span>). Columns =
            edge judges (plain + think).{" "}
            <span className="font-semibold">Done</span> after a lab run finishes. Costs show actual
            spend when run (including failed runs with partial API use); otherwise{" "}
            <span className="font-semibold">~</span> estimates from
            {costBaseline?.source === "v4_lab_run"
              ? " your completed V4×V4 lab tokens"
              : costBaseline
                ? " pipeline extract walk tokens (edge scaled)"
                : " extract data once the agenda exists"}
            . <span className="font-semibold">· think</span> cells use higher Gemini/DeepSeek
            token allowances than plain. <span className="font-semibold">V4 × V4</span> (no think) =
            saved extract.
          </p>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse text-xs">
            <colgroup>
              <col className="w-[7.5rem]" />
              {matrixSlots.map((_, index) => (
                <col key={`col-${index}`} className="w-[7.5rem]" />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-slate-600">
                  Walk ↓ Edge →
                </th>
                {matrixSlots.map((edge, edgeIndex) => (
                  <th
                    key={`edge-${edgeIndex}`}
                    className="border border-slate-200 bg-slate-50 px-2 py-2 text-center text-[11px] font-semibold whitespace-nowrap text-slate-700"
                  >
                    {segmentCompareSlotShortLabel(edge)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixSlots.map((walk, walkIndex) => (
                <tr key={`walk-${walkIndex}`}>
                  <th
                    className="border border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-slate-700"
                  >
                    {segmentCompareSlotShortLabel(walk)}
                  </th>
                  {matrixSlots.map((edge, edgeIndex) => {
                    const row = combinationRow(walk, edge);
                    const latest = latestRunForKey(runs, row.key);
                    const completed =
                      latest?.status === "completed" ? latest : null;
                    const failed = latest?.status === "failed" ? latest : null;
                    const inFlight =
                      latest?.status === "queued" || latest?.status === "running";
                    const label = formatSegmentCompareCombination(row.walk, row.edge);
                    const paneReady = paneIdForCombination(row.key, runs) !== null;
                    const cost = cellCostLabel(row.walk, row.edge, runs, costBaseline);
                    const runningCost =
                      inFlight && latest
                        ? cellRunningCostDisplay(latest, row.walk, row.edge, costBaseline)
                        : null;
                    const predictedOverlays =
                      completed?.overlays ??
                      (row.key === SAVED_EXTRACT_COMBINATION_KEY ? savedOverlays : []);
                    const goldScore =
                      goldOverlays.length === 0
                        ? null
                        : completed || row.key === SAVED_EXTRACT_COMBINATION_KEY
                          ? formatGoldScorePercent(
                              scoreOverlaysAgainstGold(predictedOverlays, goldOverlays),
                            )
                          : null;
                    return (
                      <td
                        key={row.key}
                        role="button"
                        tabIndex={0}
                        className={`cursor-pointer border border-slate-200 p-2 align-top hover:bg-slate-50/80 ${
                          runTargetKey === row.key ? "bg-teal-50 ring-1 ring-inset ring-teal-600" : ""
                        }`}
                        onClick={() => onRunTargetChange(row.key, row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRunTargetChange(row.key, row);
                          }
                        }}
                        aria-label={`Select ${label} to run`}
                        aria-pressed={runTargetKey === row.key}
                      >
                        <div className="flex min-w-[6.75rem] flex-col gap-1.5">
                          {completed ? (
                            <div className="flex items-center justify-between gap-1">
                              <span className="whitespace-nowrap text-[11px] font-semibold text-teal-800">
                                Done
                              </span>
                              <button
                                type="button"
                                className="shrink-0 text-[10px] font-medium text-slate-600 underline hover:text-slate-900"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDeleteRun(completed.id);
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ) : failed ? (
                            <span
                              className="whitespace-nowrap text-[11px] font-semibold text-red-700"
                              title={failed.error ?? undefined}
                            >
                              Failed
                            </span>
                          ) : inFlight ? (
                            <span className="whitespace-nowrap text-[11px] font-medium text-slate-600">
                              {compactMatrixProgressLabel(latest?.progressLabel)}
                            </span>
                          ) : (
                            <span className="whitespace-nowrap text-[11px] text-slate-400">
                              Not run
                            </span>
                          )}
                          {failed?.error ? (
                            <span
                              className="line-clamp-2 text-[10px] leading-tight text-red-600"
                              title={failed.error}
                            >
                              {failed.error}
                            </span>
                          ) : null}
                          {runningCost ? (
                            <div className="flex flex-col gap-0.5">
                              {runningCost.spentText ? (
                                <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-teal-900">
                                  {runningCost.spentText}
                                </span>
                              ) : null}
                              {runningCost.estimatedText ? (
                                <span className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                                  {runningCost.estimatedText}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span
                              className={`whitespace-nowrap font-medium ${
                                cost.isEstimate ? "text-slate-500" : "text-slate-800"
                              }`}
                              title={
                                cost.isEstimate
                                  ? "Estimated from baseline token profile"
                                  : "Actual lab run cost"
                              }
                            >
                              {cost.text}
                            </span>
                          )}
                          {goldScore ? (
                            <span
                              className="whitespace-nowrap text-[11px] font-semibold text-amber-800"
                              title="Mean time-span overlap versus the human gold standard"
                            >
                              Gold {goldScore}
                            </span>
                          ) : null}
                          <div className="flex justify-end gap-0.5">
                            <PaneToggle
                              compact
                              active={combinationPaneActive(row.key, "left")}
                              dimmed={!paneReady}
                              label={paneToggleHint(row.key, "left", label)}
                              onClick={(event) => {
                                event.stopPropagation();
                                assignCombination("left", row.key);
                              }}
                            >
                              L
                            </PaneToggle>
                            <PaneToggle
                              compact
                              active={combinationPaneActive(row.key, "right")}
                              dimmed={!paneReady}
                              label={paneToggleHint(row.key, "right", label)}
                              onClick={(event) => {
                                event.stopPropagation();
                                assignCombination("right", row.key);
                              }}
                            >
                              R
                            </PaneToggle>
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {activeRuns.length > 0 ? (
            <ul className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600">
              {activeRuns.map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-2 py-0.5">
                  <span className={run.status === "failed" ? "text-red-700" : undefined}>
                    {runLabel(run)} · {run.progressLabel ?? run.status}
                    {run.error ? ` — ${run.error}` : ""}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 underline"
                    onClick={() => onDeleteRun(run.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
    </>
  );
}

function CompareCombinationMatrixModal({
  open,
  onClose,
  runs,
  costBaseline,
  runTargetKey,
  runTargetRow,
  leftId,
  rightId,
  runDisabled,
  runBusy,
  onRequestRun,
  onRunTargetChange,
  onLeftChange,
  onRightChange,
  onDeleteRun,
  onError,
  goldOverlays,
  savedOverlays,
}: {
  open: boolean;
  onClose: () => void;
  runs: SegmentCompareRun[];
  costBaseline: SegmentCompareCostBaseline | null;
  runTargetKey: string;
  runTargetRow: CombinationRow | undefined;
  leftId: string;
  rightId: string;
  runDisabled: boolean;
  runBusy: boolean;
  onRequestRun: () => void;
  onRunTargetChange: (key: string, row: CombinationRow) => void;
  onLeftChange: (paneId: string) => void;
  onRightChange: (paneId: string) => void;
  onDeleteRun: (runId: string) => void;
  onError: (message: string) => void;
  goldOverlays: TranscriptSectionOverlay[];
  savedOverlays: TranscriptSectionOverlay[];
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const completedCount = countCompletedLabCombinations(runs);
  const runTargetLabel = runTargetRow
    ? formatSegmentCompareCombination(runTargetRow.walk, runTargetRow.edge)
    : null;
  const runTargetCompleted =
    runTargetRow != null &&
    latestRunForKey(runs, runTargetRow.key)?.status === "completed";

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
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[max(1rem,10vh)]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="segment-compare-matrix-title"
        className="w-[min(calc(100vw-2rem),58rem)] max-w-none rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3
              id="segment-compare-matrix-title"
              className="text-base font-semibold text-slate-900"
            >
              Walk × edge matrix
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              {completedCount}/{SEGMENT_COMPARE_MATRIX_CELL_COUNT} lab runs done. Click a cell to
              select it, assign <span className="font-semibold">L</span>/
              <span className="font-semibold">R</span> to panes.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <CompareCombinationMatrix
          runs={runs}
          costBaseline={costBaseline}
          runTargetKey={runTargetKey}
          leftId={leftId}
          rightId={rightId}
          onRunTargetChange={onRunTargetChange}
          onLeftChange={onLeftChange}
          onRightChange={onRightChange}
          onDeleteRun={onDeleteRun}
          onError={onError}
          goldOverlays={goldOverlays}
          savedOverlays={savedOverlays}
        />
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-xs text-slate-600">
            {runTargetLabel ? (
              <>
                Run target: <span className="font-semibold text-slate-900">{runTargetLabel}</span>
              </>
            ) : (
              "Click a cell to choose what to run."
            )}
          </p>
          <div className="flex shrink-0 flex-col items-stretch gap-1 sm:min-w-[11rem] sm:items-end">
            <button
              type="button"
              disabled={runDisabled}
              onClick={onRequestRun}
              className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {runBusy ? "Running…" : runTargetCompleted ? "Rerun combination" : "Run combination"}
            </button>
            {runTargetRow ? (
              <p className="text-center text-[11px] text-slate-600 sm:text-right">
                Est. {cellCostLabel(runTargetRow.walk, runTargetRow.edge, runs, costBaseline).text}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PaneToggle({
  active,
  disabled,
  dimmed,
  label,
  onClick,
  compact,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  dimmed?: boolean;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
  children?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded border font-semibold ${
        compact ? "min-w-[1.4rem] px-1 py-0.5 text-[10px]" : "min-w-[2rem] px-1.5 py-0.5 text-xs"
      } ${
        active
          ? "border-teal-700 bg-teal-700 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      } ${dimmed && !active ? "opacity-45" : ""} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children ?? (active ? "●" : "○")}
    </button>
  );
}

type CueSegmentMeta = {
  sections: TranscriptSectionOverlay[];
  position: "solo" | "first" | "middle" | "last";
  showLabel: boolean;
  segmentStartsAtCue: boolean;
};

function buildCueSegmentMeta(
  cues: MergedVttCue[],
  overlays: TranscriptSectionOverlay[],
): CueSegmentMeta[] {
  const groups = groupCuesByTranscriptSections(cues, overlays);
  const meta: CueSegmentMeta[] = cues.map(() => ({
    sections: [],
    position: "solo",
    showLabel: false,
    segmentStartsAtCue: false,
  }));

  for (const group of groups) {
    const indexes = group.cueIndexes;
    const count = indexes.length;
    for (let offset = 0; offset < count; offset += 1) {
      const cueIndex = indexes[offset];
      let position: CueSegmentMeta["position"];
      if (count === 1) position = "solo";
      else if (offset === 0) position = "first";
      else if (offset === count - 1) position = "last";
      else position = "middle";

      meta[cueIndex] = {
        sections: group.sections,
        position,
        showLabel: group.sections.length > 0 && offset === 0,
        segmentStartsAtCue: offset === 0,
      };
    }
  }

  return meta;
}

function sectionLabel(section: TranscriptSectionOverlay): string {
  return section.title ? `${section.code} — ${section.title}` : section.code;
}

function segmentBorderClass(position: CueSegmentMeta["position"], hasSection: boolean): string {
  if (!hasSection) return "border-2 border-dashed border-slate-300";
  switch (position) {
    case "solo":
      return "rounded-lg border-2";
    case "first":
      return "rounded-t-lg border-2 border-b-0";
    case "middle":
      return "border-x-2 border-y-0";
    case "last":
      return "rounded-b-lg border-2 border-t-0";
    default:
      return "border-2 border-transparent";
  }
}

type GoldRangeBorderRole = GoldSpanBorderRole;

function cueGoldRangeBorderRole(
  index: number,
  startIndex: number | null,
  hoverIndex: number | null,
): GoldRangeBorderRole {
  if (startIndex == null) return "none";
  if (hoverIndex == null) {
    return index === startIndex ? "first" : "none";
  }
  const lo = Math.min(startIndex, hoverIndex);
  const hi = Math.max(startIndex, hoverIndex);
  if (index < lo || index > hi) return "none";
  if (lo === hi) return "solo";
  if (index === lo) return "first";
  if (index === hi) return "last";
  return "middle";
}

function colorByCode(overlays: TranscriptSectionOverlay[]): Map<string, string> {
  const map = new Map<string, string>();
  let cursor = 0;
  for (const overlay of overlays) {
    const key = overlay.code.trim().toLowerCase() || overlay.id;
    if (map.has(key)) continue;
    map.set(key, SECTION_BORDER_COLORS[cursor % SECTION_BORDER_COLORS.length]);
    cursor += 1;
  }
  return map;
}

type PairedCueRowLayout = {
  reserveLabelRow: boolean;
  segmentGapBefore: boolean;
};

function buildPairedCueRowLayout(
  left: CueSegmentMeta,
  right: CueSegmentMeta,
  cueIndex: number,
): PairedCueRowLayout {
  return {
    reserveLabelRow: left.showLabel || right.showLabel,
    segmentGapBefore:
      cueIndex > 0 && (left.segmentStartsAtCue || right.segmentStartsAtCue),
  };
}

type CompareSegmentGroup = {
  cueIndexes: number[];
  sections: TranscriptSectionOverlay[];
};

function buildSegmentGroupsFromMeta(meta: CueSegmentMeta[]): CompareSegmentGroup[] {
  const groups: CompareSegmentGroup[] = [];
  for (let index = 0; index < meta.length; index += 1) {
    if (meta[index].segmentStartsAtCue || groups.length === 0) {
      groups.push({ cueIndexes: [index], sections: meta[index].sections });
    } else {
      groups[groups.length - 1].cueIndexes.push(index);
    }
  }
  return groups;
}

type ComparePairedCueGridProps = {
  cues: MergedVttCue[];
  leftMeta: CueSegmentMeta[];
  rightMeta: CueSegmentMeta[];
  colors: Map<string, string>;
  renderCueCell: (args: {
    cueIndex: number;
    side: "left" | "right";
    meta: CueSegmentMeta;
    partnerMeta: CueSegmentMeta;
    pairedRow: PairedCueRowLayout;
    segmentLabelAbove: boolean;
  }) => ReactNode;
  pairedRowForIndex?: (cueIndex: number, base: PairedCueRowLayout) => PairedCueRowLayout;
};

function ComparePairedCueGrid({
  cues,
  leftMeta,
  rightMeta,
  colors,
  renderCueCell,
  pairedRowForIndex,
}: ComparePairedCueGridProps) {
  const leftGroups = buildSegmentGroupsFromMeta(leftMeta);
  const rightGroups = buildSegmentGroupsFromMeta(rightMeta);

  function renderColumn(
    column: 1 | 2,
    groups: CompareSegmentGroup[],
    meta: CueSegmentMeta[],
    partnerMeta: CueSegmentMeta[],
    side: "left" | "right",
  ) {
    return groups.map((group) => {
      const start = group.cueIndexes[0];
      const end = group.cueIndexes[group.cueIndexes.length - 1];
      const primaryMeta = meta[start];
      const hasSections = group.sections.length > 0;

      return (
        <div
          key={`${side}-${start}-${end}`}
          className={`${column === 1 ? "col-start-1" : "col-start-2"} relative grid min-w-0 grid-rows-subgrid`}
          style={{ gridRow: `${start + 1} / ${end + 2}` }}
        >
          {hasSections && primaryMeta.showLabel ? (
            <div className="pointer-events-none absolute inset-0 z-20 overflow-visible">
              <div className="sticky z-20 flex justify-center [top:var(--compare-pane-header-offset,3.25rem)] -mx-0.5 px-0.5 pt-0.5 mb-1">
                <div className="pointer-events-auto bg-gradient-to-b from-white from-70% to-transparent pb-1 px-1 rounded-full">
                  <SegmentLabelRow meta={primaryMeta} colors={colors} visible />
                </div>
              </div>
            </div>
          ) : null}
          {group.cueIndexes.map((cueIndex, offset) => {
            const cueMeta = meta[cueIndex];
            const cuePartnerMeta = partnerMeta[cueIndex];
            const basePairedRow = buildPairedCueRowLayout(cueMeta, cuePartnerMeta, cueIndex);
            const pairedRow = pairedRowForIndex?.(cueIndex, basePairedRow) ?? basePairedRow;
            const labelSource = cueMeta.showLabel
              ? cueMeta
              : cuePartnerMeta.showLabel
                ? cuePartnerMeta
                : null;
            const showInvisibleLabel = pairedRow.reserveLabelRow && Boolean(labelSource);

            return (
              <div
                key={cueIndex}
                className="flex min-h-0 min-w-0 flex-col self-stretch"
                style={{ gridRow: offset + 1 }}
                data-gold-cue-index={side === "right" ? cueIndex : undefined}
              >
                {showInvisibleLabel && labelSource ? (
                  <SegmentLabelRow meta={labelSource} colors={colors} visible={false} />
                ) : null}
                {renderCueCell({
                  cueIndex,
                  side,
                  meta: cueMeta,
                  partnerMeta: cuePartnerMeta,
                  pairedRow,
                  segmentLabelAbove: showInvisibleLabel,
                })}
              </div>
            );
          })}
        </div>
      );
    });
  }

  return (
    <div
      className="grid grid-cols-2"
      style={{ gridTemplateRows: `repeat(${cues.length}, auto)` }}
    >
      {renderColumn(1, leftGroups, leftMeta, rightMeta, "left")}
      {renderColumn(2, rightGroups, rightMeta, leftMeta, "right")}
    </div>
  );
}

function cueEndSeconds(cue: MergedVttCue): number {
  return cueSeconds(cue.end ?? cue.start);
}

type GoldHandleHover = {
  edge: "start" | "end";
  agendaItemId: string;
};

function goldCueIndexAtClientY(clientY: number, edge: "start" | "end"): number | null {
  const rows = [...document.querySelectorAll<HTMLElement>("[data-gold-cue-index]")];
  return goldCueIndexFromBoxes(
    clientY,
    edge,
    rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        index: Number(row.dataset.goldCueIndex),
        top: rect.top,
        bottom: rect.bottom,
      };
    }),
  );
}

function SegmentLabelRow({
  meta,
  colors,
  visible,
}: {
  meta: CueSegmentMeta;
  colors: Map<string, string>;
  visible: boolean;
}) {
  const { sections } = meta;
  if (sections.length === 0) return null;

  const primary = sections[0];
  const borderColor =
    colors.get(primary.code.trim().toLowerCase() || primary.id) ?? "#cbd5e1";
  const isOverlap = sections.length > 1;
  const overlapTitle = isOverlap
    ? `Overlap: ${sections.map(sectionLabel).join(" · ")}`
    : sectionLabel(primary);

  return (
    <div
      className={`mb-1 flex flex-wrap justify-center gap-1 ${
        visible ? "" : "pointer-events-none invisible"
      }`}
      aria-hidden={!visible}
    >
      {isOverlap ? (
        <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
          Overlap
        </span>
      ) : null}
      {sections.map((section) => {
        const sectionColor =
          colors.get(section.code.trim().toLowerCase() || section.id) ?? borderColor;
        const label = sectionLabel(section);
        return (
          <span
            key={`${section.id}-${section.startSeconds}`}
            className="max-w-[95%] truncate rounded-full border bg-white px-2.5 py-0.5 text-xs font-semibold shadow-sm"
            style={{ borderColor: sectionColor, color: sectionColor }}
            title={overlapTitle}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function CueCell({
  cue,
  meta,
  partnerMeta,
  pairedRow,
  colors,
  cueIndex,
  onCueClick,
  goldRangeRole = "none",
  goldActiveSpanRole = "none",
  onGoldRangeHover,
  goldResizeHandles = { startAgendaItemId: null, endAgendaItemId: null },
  goldHandleHover = null,
  onGoldHandleHover,
  onGoldResizePointerDown,
  goldCueRow = false,
  segmentLabelAbove = false,
}: {
  cue: MergedVttCue;
  meta: CueSegmentMeta;
  partnerMeta: CueSegmentMeta;
  pairedRow: PairedCueRowLayout;
  colors: Map<string, string>;
  cueIndex: number;
  onCueClick?: (cueIndex: number) => void;
  goldRangeRole?: GoldRangeBorderRole;
  goldActiveSpanRole?: GoldRangeBorderRole;
  onGoldRangeHover?: (cueIndex: number) => void;
  goldResizeHandles?: GoldResizeHandles;
  goldHandleHover?: GoldHandleHover | null;
  onGoldHandleHover?: (target: GoldHandleHover | null) => void;
  onGoldResizePointerDown?: (
    edge: "start" | "end",
    agendaItemId: string,
    cueIndex: number,
    event: React.PointerEvent,
  ) => void;
  goldCueRow?: boolean;
  segmentLabelAbove?: boolean;
}) {
  const { sections, position, showLabel } = meta;
  const hasSection = sections.length > 0;
  const primary = sections[0];
  const color = primary
    ? colors.get(primary.code.trim().toLowerCase() || primary.id)
    : undefined;
  const borderColor = color ?? "#cbd5e1";
  const isOverlap = sections.length > 1;
  const overlapTitle = isOverlap
    ? `Overlap: ${sections.map(sectionLabel).join(" · ")}`
    : primary
      ? sectionLabel(primary)
      : "Unassigned";

  const labelSource = showLabel ? meta : partnerMeta.showLabel ? partnerMeta : null;
  const inlineLabel = !segmentLabelAbove && pairedRow.reserveLabelRow && labelSource;
  const inGoldRange = goldRangeRole !== "none";
  const highlightRole = inGoldRange ? goldRangeRole : goldActiveSpanRole;
  const isHighlighted = highlightRole !== "none";

  const effectiveRole = isHighlighted ? highlightRole : position;
  const effectiveHasSection = isHighlighted || hasSection;
  const sectionBorderClass = segmentBorderClass(effectiveRole, effectiveHasSection);
  const activeBorderColor = isHighlighted ? "#d97706" : hasSection ? borderColor : undefined;

  const interactive = Boolean(onCueClick);
  const startAgendaItemId = goldResizeHandles.startAgendaItemId;
  const endAgendaItemId = goldResizeHandles.endAgendaItemId;
  const showStartHandle = Boolean(onGoldResizePointerDown && startAgendaItemId);
  const showEndHandle = Boolean(onGoldResizePointerDown && endAgendaItemId);
  const startHandleHot =
    goldHandleHover?.edge === "start" && goldHandleHover.agendaItemId === startAgendaItemId;
  const endHandleHot =
    goldHandleHover?.edge === "end" && goldHandleHover.agendaItemId === endAgendaItemId;

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col px-1 ${pairedRow.segmentGapBefore ? "pt-3" : ""} ${
        interactive && !showStartHandle && !showEndHandle ? "cursor-pointer" : ""
      }`}
      onClick={onCueClick ? () => onCueClick(cueIndex) : undefined}
      onMouseEnter={onGoldRangeHover ? () => onGoldRangeHover(cueIndex) : undefined}
    >
      <article
        className={`relative flex-1 overflow-visible px-2.5 py-1 ${sectionBorderClass} ${
          interactive && !isHighlighted && !showStartHandle && !showEndHandle
            ? "hover:ring-2 hover:ring-inset hover:ring-amber-500/80"
            : ""
        }`}
        style={{
          borderColor: activeBorderColor,
          backgroundColor: speakerBackgroundColor(cue.speaker),
        }}
        title={hasSection ? overlapTitle : undefined}
      >
        {showStartHandle ? (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to adjust span start"
            className="absolute inset-x-0 -top-2 z-10 h-4 cursor-ns-resize"
            onPointerDown={(event) => {
              event.stopPropagation();
              onGoldResizePointerDown!("start", startAgendaItemId!, cueIndex, event);
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseEnter={() =>
              onGoldHandleHover?.({ edge: "start", agendaItemId: startAgendaItemId! })
            }
            onMouseLeave={() => onGoldHandleHover?.(null)}
          >
            <div
              className={`pointer-events-none absolute inset-x-0 top-1.5 transition-colors ${
                startHandleHot ? "h-1 bg-amber-600" : "h-0.5 bg-amber-500/70"
              }`}
            />
          </div>
        ) : null}
        {showEndHandle ? (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to adjust span end"
            className="absolute inset-x-0 -bottom-2 z-10 h-4 cursor-ns-resize"
            onPointerDown={(event) => {
              event.stopPropagation();
              onGoldResizePointerDown!("end", endAgendaItemId!, cueIndex, event);
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseEnter={() =>
              onGoldHandleHover?.({ edge: "end", agendaItemId: endAgendaItemId! })
            }
            onMouseLeave={() => onGoldHandleHover?.(null)}
          >
            <div
              className={`pointer-events-none absolute inset-x-0 bottom-1.5 transition-colors ${
                endHandleHot ? "h-1 bg-amber-600" : "h-0.5 bg-amber-500/70"
              }`}
            />
          </div>
        ) : null}
        {inlineLabel ? (
          <SegmentLabelRow meta={labelSource!} colors={colors} visible={showLabel} />
        ) : null}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-slate-900">
            {cue.speaker.trim() || "Unknown"}
          </span>
          <time className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
            {formatVttTimestamp(cue.start)}
          </time>
        </div>
        <p className="mt-0.5 text-sm leading-snug text-slate-800">{cue.text}</p>
      </article>
    </div>
  );
}

export function SegmentCompareDialog({ open, meetingId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [runTargetKey, setRunTargetKey] = useState(DEFAULT_RUN_TARGET_KEY);
  const [leftId, setLeftId] = useState(SAVED_AGENDA_COMPARE_ID);
  const [rightId, setRightId] = useState(SAVED_AGENDA_COMPARE_ID);
  const [starting, setStarting] = useState(false);
  const [pollWarning, setPollWarning] = useState<string | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  const [goldMode, setGoldMode] = useState(false);
  const [goldReferencePaneId, setGoldReferencePaneId] = useState(SAVED_AGENDA_COMPARE_ID);
  const [goldSpans, setGoldSpans] = useState<SegmentGoldSpan[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [pendingStartIndex, setPendingStartIndex] = useState<number | null>(null);
  const [pendingHoverIndex, setPendingHoverIndex] = useState<number | null>(null);
  const [goldResize, setGoldResize] = useState<{
    edge: "start" | "end";
    agendaItemId: string;
    originCueIndex: number;
    initialLo: number;
    initialHi: number;
    currentLo: number;
    currentHi: number;
  } | null>(null);
  const goldResizeRef = useRef(goldResize);
  goldResizeRef.current = goldResize;
  const [goldHandleHover, setGoldHandleHover] = useState<GoldHandleHover | null>(null);
  const [pipelineConfirmOpen, setPipelineConfirmOpen] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const goldDirtyRef = useRef(false);
  const compareScrollRef = useRef<HTMLDivElement>(null);

  async function refresh(): Promise<WorkspacePayload> {
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/segment-compare`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as WorkspacePayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load segment compare");
      }
      setWorkspace(payload);
      if (!goldDirtyRef.current) {
        setGoldSpans(payload.goldStandard?.spans ?? []);
      }
      setLeftId((id) => normalizePaneRunId(id, payload.runs));
      setRightId((id) => normalizePaneRunId(id, payload.runs));
      setPollWarning(null);
      return payload;
    } catch (caught) {
      throw new Error(describeFetchError(caught));
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void refresh()
      .then((payload) => {
        if (cancelled) return;
        const completed = payload.runs.filter((run) => run.status === "completed");
        const latest = completed[completed.length - 1];
        goldDirtyRef.current = false;
        setGoldSpans(payload.goldStandard?.spans ?? []);
        setGoldMode(false);
        setSelectedConceptId(null);
        setPendingStartIndex(null);
        setLeftId(
          (payload.goldOverlays?.length ?? 0) > 0
            ? GOLD_STANDARD_COMPARE_ID
            : SAVED_AGENDA_COMPARE_ID,
        );
        setRightId(latest?.id ?? SAVED_AGENDA_COMPARE_ID);
      })
      .catch((caught) => {
        if (!cancelled) setError(describeFetchError(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, meetingId]);

  const busy = workspace?.runs.some((run) => run.status === "queued" || run.status === "running");

  useEffect(() => {
    if (!open || !busy) return;
    const timer = window.setInterval(() => {
      void refresh()
        .then((payload) => {
          const stillBusy = payload.runs.some(
            (run) => run.status === "queued" || run.status === "running",
          );
          if (!stillBusy) {
            const latest = latestRunForKey(
              payload.runs,
              runTargetKey,
            );
            if (latest?.status === "failed" && latest.error) {
              setError(latest.error);
            }
          }
        })
        .catch((caught) => {
          setPollWarning(
            caught instanceof Error ? caught.message : String(caught),
          );
        });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [open, meetingId, busy, runTargetKey]);

  const cues = workspace?.cues ?? [];
  const savedOverlays = workspace?.savedOverlays ?? [];
  const runs = workspace?.runs ?? [];
  const costBaseline = workspace?.costBaseline ?? null;
  const agendaConcepts = workspace?.agendaConcepts ?? [];
  const liveGoldOverlays = useMemo(
    () => overlaysFromGoldSpans(agendaConcepts, goldSpans),
    [agendaConcepts, goldSpans],
  );

  const combinationRows = useMemo(() => buildCombinationRows(), []);
  const runTargetRow = useMemo(
    () => combinationRows.find((row) => row.key === runTargetKey) ?? combinationRows[0],
    [combinationRows, runTargetKey],
  );
  const runTargetCompleted =
    runTargetRow != null &&
    latestRunForKey(runs, runTargetRow.key)?.status === "completed";
  const runTargetEstimate = runTargetRow
    ? cellCostLabel(runTargetRow.walk, runTargetRow.edge, runs, costBaseline)
    : null;

  const paneOverlays = useMemo(() => {
    const byId = new Map<string, TranscriptSectionOverlay[]>();
    byId.set(SAVED_AGENDA_COMPARE_ID, savedOverlays);
    byId.set(GOLD_STANDARD_COMPARE_ID, liveGoldOverlays);
    for (const run of runs) {
      byId.set(run.id, run.overlays ?? []);
    }
    return byId;
  }, [runs, savedOverlays, liveGoldOverlays]);

  const leftOverlays = paneOverlays.get(leftId) ?? [];
  const rightOverlays = paneOverlays.get(rightId) ?? [];
  const goldReferenceOverlays = useMemo(
    () => paneOverlays.get(goldReferencePaneId) ?? savedOverlays,
    [paneOverlays, goldReferencePaneId, savedOverlays],
  );
  const colors = useMemo(() => {
    const overlaySets = goldMode
      ? [goldReferenceOverlays, liveGoldOverlays]
      : [leftOverlays, rightOverlays, savedOverlays, liveGoldOverlays];
    return colorByCode(overlaySets.flat());
  }, [
    goldMode,
    goldReferenceOverlays,
    leftOverlays,
    rightOverlays,
    savedOverlays,
    liveGoldOverlays,
  ]);

  const leftCueMeta = useMemo(
    () => buildCueSegmentMeta(cues, leftOverlays),
    [cues, leftOverlays],
  );
  const rightCueMeta = useMemo(
    () => buildCueSegmentMeta(cues, rightOverlays),
    [cues, rightOverlays],
  );
  const goldReferenceCueMeta = useMemo(
    () => buildCueSegmentMeta(cues, goldReferenceOverlays),
    [cues, goldReferenceOverlays],
  );
  const goldLabelCueMeta = useMemo(
    () => buildGoldLabelCueSegmentMeta(cues, agendaConcepts, goldSpans),
    [cues, agendaConcepts, goldSpans],
  );
  const goldCoverageByItem = useMemo(() => {
    const map = new Map<string, boolean[]>();
    for (const span of goldSpans) {
      const covered = goldCueCoverageForSpan(span, cues, cues.length);
      const existing = map.get(span.agendaItemId);
      if (!existing) {
        map.set(span.agendaItemId, covered);
        continue;
      }
      map.set(
        span.agendaItemId,
        existing.map((value, index) => value || covered[index]!),
      );
    }
    return map;
  }, [goldSpans, cues]);

  function handleRunTargetChange(key: string, _row: CombinationRow) {
    setRunTargetKey(key);
  }

  async function handleRun() {
    if (!runTargetRow) {
      setError("Choose a walk × edge combination to run.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/segment-compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walk: runTargetRow.walk, edge: runTargetRow.edge }),
      });
      const payload = (await response.json()) as { run?: SegmentCompareRun; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to start run");
      }
      await refresh();
      setRunConfirmOpen(false);
    } catch (caught) {
      setError(describeFetchError(caught));
    } finally {
      setStarting(false);
    }
  }

  async function handleDelete(runId: string) {
    const response = await fetch(
      `/api/v2/meetings/${meetingId}/segment-compare?runId=${encodeURIComponent(runId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error || "Failed to delete run");
      return;
    }
    const next = await refresh();
    const fallback = next.runs[next.runs.length - 1]?.id ?? SAVED_AGENDA_COMPARE_ID;
    if (leftId === runId) setLeftId(SAVED_AGENDA_COMPARE_ID);
    if (rightId === runId) setRightId(fallback);
  }

  useEffect(() => {
    if (!open || !goldDirtyRef.current) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/v2/meetings/${meetingId}/segment-compare`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goldSpans }),
          });
          const payload = (await response.json()) as {
            goldStandard?: SegmentGoldStandard;
            error?: string;
          };
          if (!response.ok) {
            throw new Error(payload.error || "Failed to save gold standard");
          }
          goldDirtyRef.current = false;
          if (payload.goldStandard) {
            setGoldSpans(payload.goldStandard.spans);
          }
        } catch (caught) {
          setError(describeFetchError(caught));
        }
      })();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [goldSpans, meetingId, open]);

  useEffect(() => {
    if (!goldMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPendingStartIndex(null);
        setPendingHoverIndex(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [goldMode]);

  useLayoutEffect(() => {
    const root = compareScrollRef.current;
    if (!root) return;

    function syncPaneHeaderOffset() {
      const header = root?.querySelector<HTMLElement>("[data-compare-sticky-header]");
      if (!header || !root) return;
      root.style.setProperty("--compare-pane-header-offset", `${header.offsetHeight}px`);
    }

    syncPaneHeaderOffset();
    const header = root.querySelector<HTMLElement>("[data-compare-sticky-header]");
    if (!header) return;
    const observer = new ResizeObserver(syncPaneHeaderOffset);
    observer.observe(header);
    return () => observer.disconnect();
  }, [
    goldMode,
    loading,
    workspace,
    goldReferencePaneId,
    leftId,
    rightId,
    selectedConceptId,
    pendingStartIndex,
  ]);

  function commitGoldSpans(next: SegmentGoldSpan[]) {
    goldDirtyRef.current = true;
    setGoldSpans(mergeGoldSpans(next));
  }

  function handleSelectConcept(concept: AgendaConceptRow) {
    if (!concept.isLeaf) {
      setError("Set spans on leaf agenda items. Parent items inherit their children.");
      return;
    }
    setError(null);
    setSelectedConceptId(concept.id);
    setPendingStartIndex(null);
    setPendingHoverIndex(null);
    setGoldHandleHover(null);
  }

  function handleGoldResizePointerDown(
    edge: "start" | "end",
    agendaItemId: string,
    cueIndex: number,
    event: React.PointerEvent,
  ) {
    if (pendingStartIndex != null) return;
    const span = findGoldSpanForEdge(goldSpans, agendaItemId, cueIndex, edge, cues);
    if (!span) return;
    const { lo, hi } = resolveGoldSpanCueIndices(span, cues);
    event.preventDefault();
    setGoldHandleHover({ edge, agendaItemId });
    const resizeState = {
      edge,
      agendaItemId,
      originCueIndex: cueIndex,
      initialLo: lo,
      initialHi: hi,
      currentLo: lo,
      currentHi: hi,
    };
    goldResizeRef.current = resizeState;
    setGoldResize(resizeState);
  }

  useEffect(() => {
    if (!goldResize) return;
    function onPointerMove(event: PointerEvent) {
      const active = goldResizeRef.current;
      if (!active) return;
      const { edge, originCueIndex, initialLo, initialHi, currentLo, currentHi } = active;
      const cueIndex = goldCueIndexAtClientY(event.clientY, edge) ?? originCueIndex;
      const nextLo =
        edge === "start" ? Math.max(0, Math.min(cueIndex, initialHi)) : initialLo;
      const nextHi =
        edge === "end" ? Math.min(cues.length - 1, Math.max(cueIndex, initialLo)) : initialHi;
      if (nextLo === currentLo && nextHi === currentHi) return;
      const nextState = { ...active, currentLo: nextLo, currentHi: nextHi };
      goldResizeRef.current = nextState;
      setGoldResize(nextState);
    }
    function onPointerUp() {
      const active = goldResizeRef.current;
      if (active) {
        const { agendaItemId, initialLo, initialHi, currentLo, currentHi } = active;
        if (currentLo !== initialLo || currentHi !== initialHi) {
          setGoldSpans((current) => {
            const filtered = current.filter((entry) => {
              if (entry.agendaItemId !== agendaItemId) return true;
              const { lo, hi } = resolveGoldSpanCueIndices(entry, cues);
              return !(lo === initialLo && hi === initialHi);
            });
            const newSpan = goldSpanFromCueIndexRange(agendaItemId, currentLo, currentHi, cues);
            return addGoldSpanReplacingOverlaps(filtered, newSpan, cues);
          });
          goldDirtyRef.current = true;
        }
      }
      goldResizeRef.current = null;
      setGoldResize(null);
      setGoldHandleHover(null);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [Boolean(goldResize), cues]);

  function handleGoldCueClick(cueIndex: number) {
    if (goldResize) return;
    if (!selectedConceptId) {
      setError("Select an agenda concept first, then click the start and end of its discussion.");
      return;
    }
    setError(null);
    if (pendingStartIndex == null) {
      setPendingStartIndex(cueIndex);
      setPendingHoverIndex(null);
      return;
    }
    const lo = Math.min(pendingStartIndex, cueIndex);
    const hi = Math.max(pendingStartIndex, cueIndex);
    commitGoldSpans(
      addGoldSpanReplacingOverlaps(
        goldSpans,
        goldSpanFromCueIndexRange(selectedConceptId, lo, hi, cues),
        cues,
      ),
    );
    setPendingStartIndex(null);
    setPendingHoverIndex(null);
  }

  function clearConceptSpans(conceptId: string) {
    commitGoldSpans(goldSpans.filter((span) => span.agendaItemId !== conceptId));
    if (selectedConceptId === conceptId) {
      setPendingStartIndex(null);
      setPendingHoverIndex(null);
    }
  }

  async function handleRunPipelineFromGold() {
    setPipelineBusy(true);
    setError(null);
    try {
      if (goldDirtyRef.current) {
        const saveResponse = await fetch(`/api/v2/meetings/${meetingId}/segment-compare`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goldSpans }),
        });
        const savePayload = (await saveResponse.json()) as { error?: string };
        if (!saveResponse.ok) {
          throw new Error(savePayload.error || "Failed to save gold standard");
        }
        goldDirtyRef.current = false;
      }
      const response = await fetch(`/api/v2/meetings/${meetingId}/segment-compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-pipeline-from-gold" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to start minutes pipeline");
      }
      setPipelineConfirmOpen(false);
      onClose();
    } catch (caught) {
      setError(describeFetchError(caught));
    } finally {
      setPipelineBusy(false);
    }
  }

  const labeledLeafCount = new Set(goldSpans.map((span) => span.agendaItemId)).size;
  const leafCount = agendaConcepts.filter((concept) => concept.isLeaf).length;
  const selectedConcept = agendaConcepts.find((concept) => concept.id === selectedConceptId) ?? null;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Segmenter compare</h2>
            <p className="text-sm text-slate-600">
              {goldMode
                ? "Compare a lab run on the left to your gold labels on the right. Use Combinations to change the reference walk × edge."
                : "Temporary A/B lab. Same transcript, shared scroll. Lab runs do not rewrite the saved agenda."}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        {pollWarning && !error ? (
          <p className="mt-2 text-sm text-amber-800">{pollWarning}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            className={`text-sm font-medium underline ${
              goldMode ? "text-amber-900 hover:text-amber-950" : "text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => {
              setGoldMode((current) => {
                const next = !current;
                if (next) {
                  setPendingStartIndex(null);
                  setPendingHoverIndex(null);
                  setGoldReferencePaneId(
                    leftId === GOLD_STANDARD_COMPARE_ID
                      ? defaultGoldReferencePaneId(runs)
                      : leftId,
                  );
                }
                return next;
              });
            }}
          >
            {goldMode ? "Exit gold standard" : "Gold standard"}
          </button>
          <button
            type="button"
            className="text-sm font-medium text-teal-800 underline hover:text-teal-950"
            onClick={() => setMatrixOpen(true)}
          >
            {goldMode ? "Reference combination" : "Combinations"} (
            {countCompletedLabCombinations(runs)}/{SEGMENT_COMPARE_MATRIX_CELL_COUNT} done)
          </button>
          <button
            type="button"
            className="text-sm text-slate-600 underline hover:text-slate-900"
            onClick={() => {
              void refresh().catch((caught) => setError(describeFetchError(caught)));
            }}
          >
            Refresh status
          </button>
          {liveGoldOverlays.length > 0 && !goldMode ? (
            <button
              type="button"
              className="text-sm text-amber-800 underline hover:text-amber-950"
              onClick={() => setLeftId(GOLD_STANDARD_COMPARE_ID)}
            >
              Show gold on left
            </button>
          ) : null}
          {goldMode ? (
            <span className="text-sm text-slate-600">
              {labeledLeafCount}/{leafCount} leaves labeled
            </span>
          ) : null}
          {goldMode ? (
            <button
              type="button"
              disabled={goldSpans.length === 0 || pipelineBusy}
              className="text-sm font-medium text-teal-800 underline hover:text-teal-950 disabled:cursor-not-allowed disabled:text-slate-400"
              onClick={() => setPipelineConfirmOpen(true)}
            >
              Run minutes pipeline from gold
            </button>
          ) : null}
        </div>
        {(workspace?.agendaItemCount ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-amber-800">Extract the agenda first so the walk has an outline to seed from.</p>
        ) : null}
      </header>

      <div ref={compareScrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading && !workspace ? (
          <p className="p-6 text-sm text-slate-600">Loading transcript…</p>
        ) : (
          <>
            {goldMode ? (
              <div className="grid min-h-full grid-cols-[minmax(0,1fr)_2rem_36rem] items-start">
                <div className="min-w-0">
                  <div
                    className="sticky top-0 z-30 grid grid-cols-2 border-b border-slate-200 bg-white"
                    data-compare-sticky-header
                  >
                    <ComparePaneColumnHeader
                      paneId={goldReferencePaneId}
                      runs={runs}
                      onEdit={() => setMatrixOpen(true)}
                    />
                    <GoldLabelColumnHeader
                      selectedConcept={selectedConcept}
                      pendingStartIndex={pendingStartIndex}
                      selectedConceptHasSpan={
                        selectedConceptId != null &&
                        goldSpans.some((span) => span.agendaItemId === selectedConceptId)
                      }
                    />
                  </div>
                  <ComparePairedCueGrid
                    cues={cues}
                    leftMeta={goldReferenceCueMeta}
                    rightMeta={goldLabelCueMeta}
                    colors={colors}
                    pairedRowForIndex={(_, base) => ({
                      reserveLabelRow: base.reserveLabelRow,
                      // Extra padding at a span handoff punches a hole in both
                      // columns and makes the next cue's hit box swallow the
                      // previous cue's bottom resize handle.
                      segmentGapBefore: false,
                    })}
                    renderCueCell={({
                      cueIndex: index,
                      side,
                      meta,
                      partnerMeta,
                      pairedRow,
                      segmentLabelAbove,
                    }) => {
                      const cue = cues[index];
                      if (side === "left") {
                        return (
                          <CueCell
                            cue={cue}
                            meta={meta}
                            partnerMeta={partnerMeta}
                            pairedRow={pairedRow}
                            colors={colors}
                            cueIndex={index}
                            segmentLabelAbove={segmentLabelAbove}
                          />
                        );
                      }

                      const goldRangeRole = goldResize
                        ? cueGoldRangeBorderRole(
                            index,
                            goldResize.currentLo,
                            goldResize.currentHi,
                          )
                        : cueGoldRangeBorderRole(
                            index,
                            pendingStartIndex,
                            pendingHoverIndex,
                          );
                      const goldSpanSettingActive = selectedConceptId != null;
                      const selectedConceptHasSpan =
                        goldSpanSettingActive &&
                        goldSpans.some((span) => span.agendaItemId === selectedConceptId);
                      const suppressHandles =
                        goldResize != null ||
                        pendingStartIndex != null ||
                        (selectedConceptId != null && !selectedConceptHasSpan);
                      const goldResizeHandles = goldResizeHandlesAtCue({
                        cueIndex: index,
                        coverageByItem: goldCoverageByItem,
                        preferredAgendaItemId: selectedConceptId,
                        suppressHandles,
                      });
                      const highlightItemId =
                        goldResize?.agendaItemId ??
                        goldHandleHover?.agendaItemId ??
                        (selectedConceptHasSpan ? selectedConceptId : null);
                      const highlightCovered = highlightItemId
                        ? goldCoverageByItem.get(highlightItemId)
                        : undefined;
                      const goldActiveSpanRole = highlightCovered
                        ? goldSpanBorderRoleAtIndex(index, highlightCovered)
                        : "none";

                      return (
                        <CueCell
                          cue={cue}
                          meta={meta}
                          partnerMeta={partnerMeta}
                          pairedRow={pairedRow}
                          colors={colors}
                          cueIndex={index}
                          segmentLabelAbove={segmentLabelAbove}
                          onCueClick={
                            goldSpanSettingActive ? handleGoldCueClick : undefined
                          }
                          goldRangeRole={goldRangeRole}
                          goldActiveSpanRole={goldActiveSpanRole}
                          onGoldRangeHover={
                            pendingStartIndex != null
                              ? (hoverIndex) => setPendingHoverIndex(hoverIndex)
                              : undefined
                          }
                          goldResizeHandles={goldResizeHandles}
                          goldHandleHover={goldHandleHover}
                          onGoldHandleHover={(target) => {
                            if (target) setGoldHandleHover(target);
                            else if (!goldResize) setGoldHandleHover(null);
                          }}
                          onGoldResizePointerDown={
                            pendingStartIndex == null ? handleGoldResizePointerDown : undefined
                          }
                          goldCueRow
                        />
                      );
                    }}
                  />
                </div>
                <GoldStandardTranscriptMinimap
                  scrollContainerRef={compareScrollRef}
                  cueMeta={goldLabelCueMeta}
                  colors={colors}
                />
                <aside className="sticky top-0 h-[calc(100vh-8rem)] w-[36rem] shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Agenda concepts
                    </p>
                  </div>
                  <ul className="p-2">
                    {agendaConcepts.map((concept) => {
                      const labeled = goldSpans.some((span) => span.agendaItemId === concept.id);
                      const selected = selectedConceptId === concept.id;
                      return (
                        <li key={concept.id}>
                          <div
                            className={`relative flex items-start gap-1 rounded-md ${
                              labeled ? "bg-teal-50" : ""
                            } ${
                              concept.isLeaf
                                ? labeled
                                  ? "hover:bg-teal-100"
                                  : "hover:bg-slate-50"
                                : ""
                            } ${
                              selected
                                ? "after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:shadow-[inset_0_0_0_2px_#d97706]"
                                : ""
                            }`}
                            style={{ paddingLeft: `${concept.depth * 0.75 + 0.25}rem` }}
                          >
                            <button
                              type="button"
                              disabled={!concept.isLeaf}
                              className={`min-w-0 flex-1 px-2 py-1.5 text-left text-sm ${
                                concept.isLeaf ? "" : "cursor-default text-slate-500"
                              } ${
                                selected
                                  ? "font-semibold text-amber-950"
                                  : labeled
                                    ? "font-medium text-teal-950"
                                    : "text-slate-800"
                              }`}
                              onClick={() => handleSelectConcept(concept)}
                            >
                              <span
                                className={`font-mono text-[11px] ${
                                  labeled ? "text-teal-700" : "text-slate-500"
                                }`}
                              >
                                {concept.code}
                              </span>{" "}
                              {concept.title}
                              {labeled ? (
                                <span className="ml-1.5 rounded bg-teal-200/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-900">
                                  Set
                                </span>
                              ) : null}
                            </button>
                            {concept.isLeaf && labeled ? (
                              <button
                                type="button"
                                className="shrink-0 px-1.5 py-1 text-[10px] text-slate-500 underline hover:text-slate-800"
                                onClick={() => clearConceptSpans(concept.id)}
                              >
                                Clear
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </aside>
              </div>
            ) : (
              <>
                <div
                  className="sticky top-0 z-30 grid grid-cols-2 border-b border-slate-200 bg-white"
                  data-compare-sticky-header
                >
                  <ComparePaneColumnHeader
                    paneId={leftId}
                    runs={runs}
                    onEdit={() => setMatrixOpen(true)}
                  />
                  <ComparePaneColumnHeader
                    paneId={rightId}
                    runs={runs}
                    onEdit={() => setMatrixOpen(true)}
                  />
                </div>
                <ComparePairedCueGrid
                  cues={cues}
                  leftMeta={leftCueMeta}
                  rightMeta={rightCueMeta}
                  colors={colors}
                  renderCueCell={({
                    cueIndex: index,
                    side,
                    meta,
                    partnerMeta,
                    pairedRow,
                    segmentLabelAbove,
                  }) => (
                    <CueCell
                      cue={cues[index]}
                      meta={meta}
                      partnerMeta={partnerMeta}
                      pairedRow={pairedRow}
                      colors={colors}
                      cueIndex={index}
                      segmentLabelAbove={segmentLabelAbove}
                    />
                  )}
                />
              </>
            )}
          </>
        )}
      </div>

      <CompareCombinationMatrixModal
        open={matrixOpen}
        onClose={() => setMatrixOpen(false)}
        runs={runs}
        costBaseline={costBaseline}
        runTargetKey={runTargetKey}
        runTargetRow={runTargetRow}
        leftId={goldMode ? goldReferencePaneId : leftId}
        rightId={goldMode ? goldReferencePaneId : rightId}
        runDisabled={
          starting || busy || loading || (workspace?.agendaItemCount ?? 0) === 0 || !runTargetRow
        }
        runBusy={starting || Boolean(busy)}
        onRequestRun={() => setRunConfirmOpen(true)}
        onRunTargetChange={handleRunTargetChange}
        onLeftChange={goldMode ? setGoldReferencePaneId : setLeftId}
        onRightChange={goldMode ? setGoldReferencePaneId : setRightId}
        onDeleteRun={(runId) => void handleDelete(runId)}
        onError={setError}
        goldOverlays={liveGoldOverlays}
        savedOverlays={savedOverlays}
      />

      <GoldStandardPipelineConfirmDialog
        open={pipelineConfirmOpen}
        labeledLeafCount={labeledLeafCount}
        busy={pipelineBusy}
        onCancel={() => setPipelineConfirmOpen(false)}
        onConfirm={() => void handleRunPipelineFromGold()}
      />

      {runTargetRow ? (
        <SegmentCompareRunConfirmDialog
          open={runConfirmOpen}
          rerun={runTargetCompleted}
          combinationLabel={formatSegmentCompareCombination(runTargetRow.walk, runTargetRow.edge)}
          estimatedCostLabel={
            runTargetEstimate
              ? runTargetEstimate.text.replace(/^~/, "")
              : null
          }
          walk={runTargetRow.walk}
          edge={runTargetRow.edge}
          busy={starting}
          onCancel={() => setRunConfirmOpen(false)}
          onConfirm={() => void handleRun()}
        />
      ) : null}
    </div>
  );
}
