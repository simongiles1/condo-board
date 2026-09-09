"use client";

import { useEffect, useRef, useState } from "react";

import { ReadableTranscriptView } from "@/components/ReadableTranscriptView";
import type { MergedVttCue } from "@/lib/parsers/vtt";
import { parseVttTimeRangesMs } from "@/lib/parsers/vtt";

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
  const firstHighlightRef = useRef<HTMLElement>(null);

  const highlightRangesMs = timeRange ? parseVttTimeRangesMs(timeRange) : undefined;

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

  useEffect(() => {
    if (!loading && cues.length > 0 && firstHighlightRef.current) {
      firstHighlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading, cues]);

  if (!open || !timeRange) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-range-title"
        className="relative flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="transcript-range-title" className="text-lg font-semibold text-slate-900">
                Transcript Excerpt
              </h2>
              <span className="rounded-md bg-teal-100 px-2 py-0.5 font-mono text-xs font-semibold text-teal-800">
                {timeRange}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Discussion matching this agenda topic
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {loading ? (
            <p className="px-4 text-sm text-slate-600">Loading transcript…</p>
          ) : error ? (
            <div className="mx-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {error}
            </div>
          ) : cues.length === 0 ? (
            <p className="px-4 text-sm text-slate-600">No transcript dialogue found for this meeting.</p>
          ) : (
            <ReadableTranscriptView
              cues={cues}
              highlightRangesMs={highlightRangesMs}
              firstHighlightRef={firstHighlightRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}
