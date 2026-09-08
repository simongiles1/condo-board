"use client";

import { useEffect, useRef, useState } from "react";

import type { MergedVttCue } from "@/lib/parsers/vtt";

function parseMs(timestamp: string): number {
  const parts = timestamp.split(":");
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    hours = parseFloat(parts[0]);
    minutes = parseFloat(parts[1]);
    seconds = parseFloat(parts[2]);
  } else if (parts.length === 2) {
    minutes = parseFloat(parts[0]);
    seconds = parseFloat(parts[1]);
  }
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

export function TranscriptRangeModal({
  open,
  meetingId,
  timeRange,
  onClose,
}: {
  open: boolean;
  meetingId: string;
  timeRange: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<MergedVttCue[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const firstHighlightRef = useRef<HTMLDivElement>(null);

  // Parse start and end time from timeRange (e.g. "00:00:03 - 00:06:51")
  const [startMs, endMs] = (() => {
    if (!timeRange) return [0, Infinity];
    const match = timeRange.match(/(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*[-–]\s*(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/);
    if (match) {
      return [parseMs(match[1]), parseMs(match[2])];
    }
    return [0, Infinity];
  })();

  useEffect(() => {
    if (!open) {
      setCues([]);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/meetings/${meetingId}/transcript`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        if (data.cues) {
          setCues(data.cues);
        } else {
          setError("No transcript cues available");
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load transcript");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, meetingId]);

  // Scroll to first highlighted cue after load
  useEffect(() => {
    if (!loading && cues.length > 0 && firstHighlightRef.current) {
      firstHighlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading, cues]);

  if (!open || !timeRange) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-100 text-teal-700 text-sm font-semibold">
              🎧
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900 text-sm">Transcript Excerpt</h3>
                <span className="rounded bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800">
                  {timeRange}
                </span>
              </div>
              <p className="text-xs text-slate-500">Highlighted discussion matching this agenda topic</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            ✕
          </button>
        </div>

        {/* Cues List */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-xs text-slate-400">
              Loading transcript...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
              {error}
            </div>
          ) : cues.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-xs text-slate-400">
              No transcript dialogue found for this meeting.
            </div>
          ) : (
            (() => {
              let firstRefAssigned = false;
              return cues.map((cue, idx) => {
                const cueStart = parseMs(cue.start);
                const cueEnd = parseMs(cue.end);
                const isHighlighted = cueEnd >= startMs && cueStart <= endMs;

                let refToAssign = undefined;
                if (isHighlighted && !firstRefAssigned) {
                  refToAssign = firstHighlightRef;
                  firstRefAssigned = true;
                }

                return (
                  <div
                    key={idx}
                    ref={refToAssign}
                    className={`rounded-xl p-3 text-xs transition border ${
                      isHighlighted
                        ? "bg-teal-50/90 border-teal-300 shadow-xs"
                        : "bg-slate-50/40 border-slate-100 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[11px] font-semibold text-slate-500">
                        [{cue.start}]
                      </span>
                      {cue.speaker ? (
                        <span className="font-semibold text-slate-800">{cue.speaker}</span>
                      ) : null}
                      {isHighlighted ? (
                        <span className="rounded bg-teal-200/80 px-1.5 py-0.2 text-[10px] font-bold text-teal-900">
                          MATCH
                        </span>
                      ) : null}
                    </div>
                    <p className="text-slate-700 leading-relaxed pl-2 border-l-2 border-slate-200">
                      {cue.text}
                    </p>
                  </div>
                );
              });
            })()
          )}
        </div>
      </div>
    </div>
  );
}
