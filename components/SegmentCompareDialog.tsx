"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  SECTION_BORDER_COLORS,
  speakerBackgroundColor,
} from "@/components/ReadableTranscriptView";
import type { MergedVttCue } from "@/lib/parsers/vtt";
import { formatVttTimestamp } from "@/lib/parsers/vtt";
import {
  combinationKeysFromRuns,
  enumerateSegmentCompareCombinations,
  formatSegmentCompareCombination,
  formatSegmentCompareChoice,
  SAVED_AGENDA_COMPARE_ID,
  SEGMENT_COMPARE_MODELS,
  SEGMENT_COMPARE_SAVED_REVIEW_KEY,
  segmentCompareCombinationKey,
  type SegmentCompareModelId,
  type SegmentCompareModelOption,
  type SegmentCompareRun,
  type SegmentCompareSlotChoice,
} from "@/lib/meeting-v2/segment-compare-models";
import {
  groupCuesByTranscriptSections,
  type TranscriptSectionOverlay,
} from "@/lib/transcript/section-overlay";

type WorkspacePayload = {
  models: SegmentCompareModelOption[];
  cues: MergedVttCue[];
  savedOverlays: TranscriptSectionOverlay[];
  runs: SegmentCompareRun[];
  reviewedKeys: string[];
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

const DEFAULT_CHOICE: SegmentCompareSlotChoice = {
  modelId: "deepseek-v4-flash",
  thinking: false,
};

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

function buildCombinationRows(runs: SegmentCompareRun[]): CombinationRow[] {
  const rows = enumerateSegmentCompareCombinations();
  const seen = new Set(rows.map((row) => row.key));
  for (const extra of combinationKeysFromRuns(runs)) {
    if (seen.has(extra.key)) continue;
    seen.add(extra.key);
    rows.push(extra);
  }
  return rows;
}

function CompareCombinationPicker({
  meetingId,
  runs,
  reviewedKeys,
  leftId,
  rightId,
  onReviewedKeysChange,
  onLeftChange,
  onRightChange,
  onDeleteRun,
  onError,
}: {
  meetingId: string;
  runs: SegmentCompareRun[];
  reviewedKeys: string[];
  leftId: string;
  rightId: string;
  onReviewedKeysChange: (keys: string[]) => void;
  onLeftChange: (paneId: string) => void;
  onRightChange: (paneId: string) => void;
  onDeleteRun: (runId: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const combinationRows = useMemo(() => buildCombinationRows(runs), [runs]);
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

  async function persistReviewedKeys(next: string[]) {
    setSavingReview(true);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/segment-compare`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewedKeys: next }),
      });
      const payload = (await response.json()) as { reviewedKeys?: string[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save reviewed combinations");
      }
      onReviewedKeysChange(payload.reviewedKeys ?? next);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingReview(false);
    }
  }

  function toggleReviewed(key: string, checked: boolean) {
    const next = checked
      ? [...new Set([...reviewedKeys, key])]
      : reviewedKeys.filter((entry) => entry !== key);
    onReviewedKeysChange(next);
    void persistReviewedKeys(next);
  }

  function assignPane(side: "left" | "right", paneId: string) {
    if (side === "left") onLeftChange(paneId);
    else onRightChange(paneId);
  }

  function assignCombination(side: "left" | "right", key: string) {
    const run = latestCompletedRunForKey(runs, key);
    if (!run) {
      onError("Run this combination first to show it in a pane.");
      return;
    }
    assignPane(side, run.id);
  }

  function paneActive(paneId: string, side: "left" | "right"): boolean {
    return side === "left" ? leftId === paneId : rightId === paneId;
  }

  function combinationPaneActive(key: string, side: "left" | "right"): boolean {
    const run = latestCompletedRunForKey(runs, key);
    if (!run) return false;
    return paneActive(run.id, side);
  }

  const summary = `${paneTitle(leftId, runs)} · vs · ${paneTitle(rightId, runs)}`;
  const reviewedCount = reviewedKeys.length;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="min-w-0 truncate font-medium">{summary}</span>
        <span className="shrink-0 text-xs text-slate-500">
          {reviewedCount} checked{savingReview ? " · saving…" : ""}
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-[min(24rem,70vh)] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
            Check combinations you have reviewed. Pick <span className="font-semibold">L</span> /{" "}
            <span className="font-semibold">R</span> for each pane. Saved agenda is the current
            pipeline extract (typically V4 Flash walk and edge).
          </p>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-2 py-1.5 font-semibold">Done</th>
                <th className="px-2 py-1.5 font-semibold">Source</th>
                <th className="w-16 px-2 py-1.5 text-center font-semibold">L</th>
                <th className="w-16 px-2 py-1.5 text-center font-semibold">R</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="px-2 py-1.5 align-top">
                  <input
                    type="checkbox"
                    checked={reviewedKeys.includes(SEGMENT_COMPARE_SAVED_REVIEW_KEY)}
                    disabled={savingReview}
                    onChange={(event) =>
                      toggleReviewed(SEGMENT_COMPARE_SAVED_REVIEW_KEY, event.target.checked)
                    }
                    aria-label="Mark saved agenda reviewed"
                  />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <span className="font-medium text-slate-900">Saved agenda (current extract)</span>
                </td>
                <td className="px-2 py-1.5 text-center align-top">
                  <PaneToggle
                    active={paneActive(SAVED_AGENDA_COMPARE_ID, "left")}
                    label="Set left pane to saved agenda"
                    onClick={() => assignPane("left", SAVED_AGENDA_COMPARE_ID)}
                  />
                </td>
                <td className="px-2 py-1.5 text-center align-top">
                  <PaneToggle
                    active={paneActive(SAVED_AGENDA_COMPARE_ID, "right")}
                    label="Set right pane to saved agenda"
                    onClick={() => assignPane("right", SAVED_AGENDA_COMPARE_ID)}
                  />
                </td>
              </tr>
              {combinationRows.map((row) => {
                const completed = latestCompletedRunForKey(runs, row.key);
                const label = formatSegmentCompareCombination(row.walk, row.edge);
                return (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="checkbox"
                        checked={reviewedKeys.includes(row.key)}
                        disabled={savingReview}
                        onChange={(event) => toggleReviewed(row.key, event.target.checked)}
                        aria-label={`Mark ${label} reviewed`}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <div className="font-medium text-slate-900">{label}</div>
                      {completed ? (
                        <div className="text-xs text-slate-500">
                          Run · {formatUsd(completed.totalCostUsd)}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400">Not run yet</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center align-top">
                      <PaneToggle
                        active={combinationPaneActive(row.key, "left")}
                        disabled={!completed}
                        label={`Set left pane to ${label}`}
                        onClick={() => assignCombination("left", row.key)}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center align-top">
                      <PaneToggle
                        active={combinationPaneActive(row.key, "right")}
                        disabled={!completed}
                        label={`Set right pane to ${label}`}
                        onClick={() => assignCombination("right", row.key)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activeRuns.length > 0 ? (
            <ul className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
              {activeRuns.map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-2 py-0.5">
                  <span>
                    {runLabel(run)} · {run.progressLabel ?? run.status}
                    {run.error ? ` · ${run.error}` : ""}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-slate-500 underline hover:text-slate-800"
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
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`min-w-[2rem] rounded border px-1.5 py-0.5 text-xs font-semibold ${
        active
          ? "border-teal-700 bg-teal-700 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {active ? "●" : "○"}
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

function ModelSlotPicker({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: SegmentCompareSlotChoice;
  models: SegmentCompareModelOption[];
  onChange: (next: SegmentCompareSlotChoice) => void;
}) {
  const selected = models.find((model) => model.id === value.modelId);
  return (
    <fieldset className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="min-w-[12rem] flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
          value={value.modelId}
          onChange={(event) =>
            onChange({
              ...value,
              modelId: event.target.value as SegmentCompareModelId,
            })
          }
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={value.thinking}
            onChange={(event) => onChange({ ...value, thinking: event.target.checked })}
          />
          Thinking
        </label>
      </div>
      {selected?.warning ? (
        <p className="mt-1 text-xs text-amber-800">{selected.warning}</p>
      ) : null}
    </fieldset>
  );
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
  const [walk, setWalk] = useState<SegmentCompareSlotChoice>(DEFAULT_CHOICE);
  const [edge, setEdge] = useState<SegmentCompareSlotChoice>(DEFAULT_CHOICE);
  const [leftId, setLeftId] = useState(SAVED_AGENDA_COMPARE_ID);
  const [rightId, setRightId] = useState(SAVED_AGENDA_COMPARE_ID);
  const [reviewedKeys, setReviewedKeys] = useState<string[]>([]);
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
    setReviewedKeys(payload.reviewedKeys ?? []);
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
        setReviewedKeys(payload.reviewedKeys ?? []);
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

  const models = workspace?.models?.length ? workspace.models : SEGMENT_COMPARE_MODELS;
  const cues = workspace?.cues ?? [];
  const savedOverlays = workspace?.savedOverlays ?? [];
  const runs = workspace?.runs ?? [];

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

  async function handleRun() {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/segment-compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walk, edge }),
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
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <ModelSlotPicker label="Overall segmenter (transcript walk)" value={walk} models={models} onChange={setWalk} />
          <ModelSlotPicker label="Edge detection (span / gap judges)" value={edge} models={models} onChange={setEdge} />
          <div className="flex items-end">
            <button
              type="button"
              disabled={starting || busy || loading || (workspace?.agendaItemCount ?? 0) === 0}
              onClick={() => void handleRun()}
              className="w-full rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
        <label className="text-sm font-medium text-slate-700">
          Compare panes &amp; progress
          <div className="mt-1">
            <CompareCombinationPicker
              meetingId={meetingId}
              runs={runs}
              reviewedKeys={reviewedKeys}
              leftId={leftId}
              rightId={rightId}
              onReviewedKeysChange={setReviewedKeys}
              onLeftChange={setLeftId}
              onRightChange={setRightId}
              onDeleteRun={(runId) => void handleDelete(runId)}
              onError={setError}
            />
          </div>
        </label>
      </div>

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
