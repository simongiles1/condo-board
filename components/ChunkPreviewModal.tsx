"use client";

import { useEffect, useMemo, useState } from "react";

import { formatChunkTextForDisplay } from "@/lib/meeting-v2/chunk-display";

type ChunkData = {
  id: string;
  aiChunkId: string;
  chunkLabel?: string;
  chunkKind: "document" | "transcript";
  pageStart?: number | null;
  pageEnd?: number | null;
  pageNumbers?: number[];
  startTimestamp?: string | null;
  endTimestamp?: string | null;
  text: string;
};

export function ChunkPreviewModal({
  open,
  meetingId,
  chunkId,
  onClose,
  elevated = false,
}: {
  open: boolean;
  meetingId: string;
  chunkId: string | null;
  onClose: () => void;
  elevated?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunk, setChunk] = useState<ChunkData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !chunkId) {
      setChunk(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/v2/meetings/${meetingId}/chunks?chunkId=${encodeURIComponent(chunkId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
        } else {
          setChunk(data.chunk);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load chunk");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, meetingId, chunkId]);

  const isDoc = chunk?.chunkKind === "document";
  const displayText = useMemo(() => {
    if (!chunk?.text) return "";
    return formatChunkTextForDisplay(chunk.text, chunk.chunkKind);
  }, [chunk?.chunkKind, chunk?.text]);

  if (!open || !chunkId) return null;

  async function handleCopy() {
    if (!chunk?.text) return;
    try {
      await navigator.clipboard.writeText(chunk.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`fixed inset-0 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs ${elevated ? "z-[80]" : "z-50"}`}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-semibold ${
                isDoc ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {isDoc ? "📄" : "🎙️"}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900 text-sm">{chunkId}</h3>
                {chunk?.chunkKind ? (
                  <span className="rounded bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-700 uppercase">
                    {chunk.chunkKind}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-slate-500">
                {isDoc
                  ? chunk?.pageNumbers && chunk.pageNumbers.length > 0
                    ? `Board Package Pages ${chunk.pageNumbers.join(", ")}`
                    : `Pages ${chunk?.pageStart ?? 0}-${chunk?.pageEnd ?? 0}`
                  : `Transcript ${chunk?.startTimestamp ?? ""} - ${chunk?.endTimestamp ?? ""}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {chunk?.text ? (
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-xs text-slate-400">
              Loading chunk details...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
              {error}
            </div>
          ) : chunk ? (
            <div className="space-y-4">
              {chunk.chunkLabel ? (
                <div className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900">
                  {chunk.chunkLabel}
                </div>
              ) : null}
              <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm leading-7 whitespace-pre-wrap text-slate-800 font-sans">
                {displayText}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
