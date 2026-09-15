"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  SECTION_BORDER_COLORS,
  speakerBackgroundColor,
} from "@/components/ReadableTranscriptView";
import type { MergedVttCue } from "@/lib/parsers/vtt";
import { formatVttTimestamp } from "@/lib/parsers/vtt";
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
  groupCuesByTranscriptSections,
  type TranscriptSectionOverlay,
} from "@/lib/transcript/section-overlay";

type WorkspacePayload = {
  cues: MergedVttCue[];
  savedOverlays: TranscriptSectionOverlay[];
  runs: SegmentCompareRun[];
  agendaItemCount: number;
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

function paneTitle(paneId: string, runs: SegmentCompareRun[]): string {
  if (paneId === SAVED_AGENDA_COMPARE_ID) {
    return "Saved agenda (current extract)";
  }
  const run = runs.find((entry) => entry.id === paneId);
  return run ? runLabel(run) : "Unknown source";
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

function CompareCombinationPicker({
  runs,
  runTargetKey,
  leftId,
  rightId,
  onRunTargetChange,
  onLeftChange,
  onRightChange,
  onDeleteRun,
  onError,
}: {
  runs: SegmentCompareRun[];
  runTargetKey: string;
  leftId: string;
  rightId: string;
  onRunTargetChange: (key: string, row: CombinationRow) => void;
  onLeftChange: (paneId: string) => void;
  onRightChange: (paneId: string) => void;
  onDeleteRun: (runId: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const combinationRows = useMemo(() => buildCombinationRows(), []);
  const matrixSlots = useMemo(() => segmentCompareMatrixSlots(), []);
  const activeRuns = runs.filter((run) => run.status !== "completed");

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function assignPane(side: "left" | "right", paneId: string) {
    if (side === "left") onLeftChange(paneId);
    else onRightChange(paneId);
  }

  function assignCombination(side: "left" | "right", key: string) {
    const paneId = paneIdForCombination(key, runs);
    if (!paneId) {
      onError("Run this combination in the lab first, or use the V4 × V4 cell for the saved extract.");
      return;
    }
    assignPane(side, paneId);
  }

  function paneActive(paneId: string, side: "left" | "right"): boolean {
    return side === "left" ? leftId === paneId : rightId === paneId;
  }

  function combinationPaneActive(key: string, side: "left" | "right"): boolean {
    const paneId = paneIdForCombination(key, runs);
    if (!paneId) return false;
    return paneActive(paneId, side);
  }

  const runTargetRow = combinationRows.find((row) => row.key === runTargetKey);
  const runTargetLabel = runTargetRow
    ? formatSegmentCompareCombination(runTargetRow.walk, runTargetRow.edge)
    : "Select combination";
  const completedCount = countCompletedLabCombinations(runs);

  function combinationRow(walk: SegmentCompareSlotChoice, edge: SegmentCompareSlotChoice): CombinationRow {
    return {
      key: segmentCompareCombinationKey(walk, edge),
      walk,
      edge,
    };
  }

  return (
    <div className="relative z-10 min-w-0 flex-1" ref={panelRef}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left hover:bg-slate-50"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Walk × edge matrix
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">
            Run: {runTargetLabel}
          </span>
        </span>
        <span className="shrink-0 pt-1 text-xs text-slate-500">
          {completedCount}/{SEGMENT_COMPARE_MATRIX_CELL_COUNT} lab runs done · {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-[min(calc(100vw-2rem),58rem)] max-w-none rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-3 text-xs leading-relaxed text-slate-600">
            Rows = walk model (plain + <span className="font-semibold">· think</span>). Columns =
            edge judges (plain + think).{" "}
            <span className="font-semibold">Done</span> appears after a lab run finishes.{" "}
            <span className="font-semibold">V4 × V4</span> (no think) also shows the saved pipeline
            extract before you run the lab. <span className="font-semibold">L</span> /{" "}
            <span className="font-semibold">R</span> assign panes.
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
                    const completed = latestCompletedRunForKey(runs, row.key);
                    const isSavedCell = row.key === SAVED_EXTRACT_COMBINATION_KEY;
                    const label = formatSegmentCompareCombination(row.walk, row.edge);
                    const paneReady = paneIdForCombination(row.key, runs) !== null;
                    return (
                      <td
                        key={row.key}
                        className={`border border-slate-200 p-2 align-top ${
                          runTargetKey === row.key ? "bg-teal-50 ring-1 ring-inset ring-teal-600" : ""
                        }`}
                      >
                        <div className="flex min-w-[6.75rem] flex-col gap-1.5">
                          {completed ? (
                            <span className="whitespace-nowrap text-[11px] font-semibold text-teal-800">
                              Done
                            </span>
                          ) : (
                            <span className="whitespace-nowrap text-[11px] text-slate-400">
                              Not run
                            </span>
                          )}
                          {isSavedCell ? (
                            <span className="whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                              Saved extract
                            </span>
                          ) : null}
                          {completed ? (
                            <span className="whitespace-nowrap text-slate-500">
                              {formatUsd(completed.totalCostUsd)}
                            </span>
                          ) : null}
                          <label className="flex items-center gap-1.5 whitespace-nowrap text-slate-700">
                            <input
                              type="radio"
                              name="segment-compare-run-target"
                              className="h-3 w-3"
                              checked={runTargetKey === row.key}
                              onChange={() => onRunTargetChange(row.key, row)}
                              aria-label={`Run target ${label}`}
                            />
                            <span>Run</span>
                          </label>
                          <div className="flex gap-0.5">
                            <PaneToggle
                              compact
                              active={combinationPaneActive(row.key, "left")}
                              disabled={!paneReady}
                              label={`Left pane: ${label}`}
                              onClick={() => assignCombination("left", row.key)}
                            >
                              L
                            </PaneToggle>
                            <PaneToggle
                              compact
                              active={combinationPaneActive(row.key, "right")}
                              disabled={!paneReady}
                              label={`Right pane: ${label}`}
                              onClick={() => assignCombination("right", row.key)}
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
                  <span>
                    {runLabel(run)} · {run.progressLabel ?? run.status}
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
        </div>
      ) : null}
    </div>
  );
}

function PaneToggle({
  active,
  disabled,
  label,
  onClick,
  compact,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
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
      } disabled:cursor-not-allowed disabled:opacity-40`}
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
  if (!hasSection) return "";
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
      return "";
  }
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

function CueCell({
  cue,
  meta,
  colors,
  cueIndex,
}: {
  cue: MergedVttCue;
  meta: CueSegmentMeta;
  colors: Map<string, string>;
  cueIndex: number;
}) {
  const { sections, position, showLabel, segmentStartsAtCue } = meta;
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

  return (
    <div
      className={`min-h-full px-1 ${segmentStartsAtCue && cueIndex > 0 ? "mt-3" : ""}`}
    >
      <article
        className={`px-2.5 py-1 ${segmentBorderClass(position, hasSection)}`}
        style={{
          borderColor: hasSection ? borderColor : undefined,
          backgroundColor: speakerBackgroundColor(cue.speaker),
        }}
        title={hasSection ? overlapTitle : undefined}
      >
        {showLabel ? (
          <div className="mb-1 flex flex-wrap justify-center gap-1">
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

  async function refresh() {
    const response = await fetch(`/api/v2/meetings/${meetingId}/segment-compare`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as WorkspacePayload & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load segment compare");
    }
    setWorkspace(payload);
    return payload;
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
        setLeftId(SAVED_AGENDA_COMPARE_ID);
        setRightId(latest?.id ?? SAVED_AGENDA_COMPARE_ID);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
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
      void refresh().catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [open, meetingId, busy]);

  const cues = workspace?.cues ?? [];
  const savedOverlays = workspace?.savedOverlays ?? [];
  const runs = workspace?.runs ?? [];

  const combinationRows = useMemo(() => buildCombinationRows(), []);
  const runTargetRow = useMemo(
    () => combinationRows.find((row) => row.key === runTargetKey) ?? combinationRows[0],
    [combinationRows, runTargetKey],
  );

  const paneOverlays = useMemo(() => {
    const byId = new Map<string, TranscriptSectionOverlay[]>();
    byId.set(SAVED_AGENDA_COMPARE_ID, savedOverlays);
    for (const run of runs) {
      byId.set(run.id, run.overlays ?? []);
    }
    return byId;
  }, [runs, savedOverlays]);

  const leftOverlays = paneOverlays.get(leftId) ?? [];
  const rightOverlays = paneOverlays.get(rightId) ?? [];
  const colors = useMemo(
    () => colorByCode([...leftOverlays, ...rightOverlays, ...savedOverlays]),
    [leftOverlays, rightOverlays, savedOverlays],
  );

  const leftCueMeta = useMemo(
    () => buildCueSegmentMeta(cues, leftOverlays),
    [cues, leftOverlays],
  );
  const rightCueMeta = useMemo(
    () => buildCueSegmentMeta(cues, rightOverlays),
    [cues, rightOverlays],
  );

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
      if (payload.run?.id) setRightId(payload.run.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Segmenter compare</h2>
            <p className="text-sm text-slate-600">
              Temporary A/B lab. Same transcript, shared scroll. Does not rewrite the saved agenda.
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
        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-end">
          <CompareCombinationPicker
            runs={runs}
            runTargetKey={runTargetKey}
            leftId={leftId}
            rightId={rightId}
            onRunTargetChange={handleRunTargetChange}
            onLeftChange={setLeftId}
            onRightChange={setRightId}
            onDeleteRun={(runId) => void handleDelete(runId)}
            onError={setError}
          />
          <div className="flex shrink-0 flex-col gap-2 sm:w-48">
            <button
              type="button"
              disabled={
                starting || busy || loading || (workspace?.agendaItemCount ?? 0) === 0 || !runTargetRow
              }
              onClick={() => void handleRun()}
              className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting || busy ? "Running…" : "Run combination"}
            </button>
          </div>
        </div>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        {(workspace?.agendaItemCount ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-amber-800">Extract the agenda first so the walk has an outline to seed from.</p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !workspace ? (
          <p className="p-6 text-sm text-slate-600">Loading transcript…</p>
        ) : (
          <div className="grid grid-cols-2">
            {cues.map((cue, index) => (
              <div key={`${cue.start}-${index}`} className="contents">
                <CueCell cue={cue} meta={leftCueMeta[index]} colors={colors} cueIndex={index} />
                <CueCell cue={cue} meta={rightCueMeta[index]} colors={colors} cueIndex={index} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
