"use client";

import { useEffect, useMemo, useState } from "react";

import {
  SECTION_BORDER_COLORS,
  speakerBackgroundColor,
} from "@/components/ReadableTranscriptView";
import type { MergedVttCue } from "@/lib/parsers/vtt";
import { formatVttTimestamp, parseVttTimestampMs } from "@/lib/parsers/vtt";
import {
  formatSegmentCompareChoice,
  SAVED_AGENDA_COMPARE_ID,
  SEGMENT_COMPARE_MODELS,
  type SegmentCompareModelId,
  type SegmentCompareModelOption,
  type SegmentCompareRun,
  type SegmentCompareSlotChoice,
} from "@/lib/meeting-v2/segment-compare-models";
import {
  pickSectionsForTime,
  type TranscriptSectionOverlay,
} from "@/lib/transcript/section-overlay";

type WorkspacePayload = {
  models: SegmentCompareModelOption[];
  cues: MergedVttCue[];
  savedOverlays: TranscriptSectionOverlay[];
  runs: SegmentCompareRun[];
  agendaItemCount: number;
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
  return `${formatSegmentCompareChoice(run.walk)} × ${formatSegmentCompareChoice(run.edge)}`;
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
  overlays,
  colors,
}: {
  cue: MergedVttCue;
  overlays: TranscriptSectionOverlay[];
  colors: Map<string, string>;
}) {
  const startSeconds = parseVttTimestampMs(cue.start) / 1000;
  const endSeconds = parseVttTimestampMs(cue.end) / 1000;
  const sections = pickSectionsForTime(startSeconds, overlays, endSeconds);
  const primary = sections[0];
  const color = primary
    ? colors.get(primary.code.trim().toLowerCase() || primary.id)
    : undefined;
  const label = primary
    ? primary.title
      ? `${primary.code} — ${primary.title}`
      : primary.code
    : "Unassigned";

  return (
    <article
      className="border-l-4 px-2.5 py-1"
      style={{
        borderLeftColor: color ?? "#cbd5e1",
        backgroundColor: speakerBackgroundColor(cue.speaker),
      }}
      title={
        sections.length > 1
          ? `Overlap: ${sections.map((section) => section.code).join(" · ")}`
          : label
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs font-semibold text-slate-700">{label}</span>
        <time className="shrink-0 font-mono text-[10px] tabular-nums text-slate-500">
          {formatVttTimestamp(cue.start)}
        </time>
      </div>
      <p className="mt-0.5 text-sm leading-snug text-slate-800">
        <span className="font-semibold text-slate-900">{cue.speaker.trim() || "Unknown"}: </span>
        {cue.text}
      </p>
    </article>
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

  const paneOptions = [
    { id: SAVED_AGENDA_COMPARE_ID, label: "Saved agenda (current extract)" },
    ...runs.map((run) => ({
      id: run.id,
      label: `${run.status === "completed" ? "" : `[${run.status}] `}${runLabel(run)} · ${formatUsd(run.totalCostUsd)}`,
    })),
  ];

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
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-700">
            Left pane
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={leftId}
              onChange={(event) => setLeftId(event.target.value)}
            >
              {paneOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Right pane
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={rightId}
              onChange={(event) => setRightId(event.target.value)}
            >
              {paneOptions.map((option) => (
                <option key={`right-${option.id}`} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {runs.length > 0 ? (
          <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-slate-600">
            {runs
              .slice()
              .reverse()
              .map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-2">
                  <span>
                    {runLabel(run)}
                    {run.status !== "completed" ? ` · ${run.progressLabel ?? run.status}` : ""}
                    {run.walkUsage || run.edgeUsage
                      ? ` · walk ${formatUsd(run.walkUsage?.costUsd)} / edge ${formatUsd(run.edgeUsage?.costUsd)} · total ${formatUsd(run.totalCostUsd)}`
                      : ""}
                    {run.error ? ` · ${run.error}` : ""}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-slate-500 underline hover:text-slate-800"
                    onClick={() => void handleDelete(run.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !workspace ? (
          <p className="p-6 text-sm text-slate-600">Loading transcript…</p>
        ) : (
          <div className="grid grid-cols-2">
            {cues.map((cue, index) => (
              <div key={`${cue.start}-${index}`} className="contents">
                <CueCell cue={cue} overlays={leftOverlays} colors={colors} />
                <CueCell cue={cue} overlays={rightOverlays} colors={colors} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
