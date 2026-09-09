"use client";

import { useEffect, useState } from "react";

import { ChunkPreviewModal } from "@/components/ChunkPreviewModal";

type ListedChunk = {
  id: string;
  aiChunkId: string;
  chunkLabel?: string;
  chunkKind: "document" | "transcript";
  pageStart?: number | null;
  pageEnd?: number | null;
  pageNumbers?: number[];
  startTimestamp?: string | null;
  endTimestamp?: string | null;
};

export function SectionChunksDialog({
  open,
  meetingId,
  agendaItemId,
  heading,
  onClose,
}: {
  open: boolean;
  meetingId: string;
  agendaItemId: string | null;
  heading: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<ListedChunk[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !agendaItemId) {
      setChunks([]);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetch(
      `/api/v2/meetings/${meetingId}/chunks?agendaItemId=${encodeURIComponent(agendaItemId)}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { error?: string; chunks?: ListedChunk[] }) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setChunks(data.chunks ?? []);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load chunks");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, meetingId, agendaItemId]);

  if (!open || !agendaItemId) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-slate-900/40"
          onClick={onClose}
          aria-label="Close chunk list"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="section-chunks-title"
          className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 id="section-chunks-title" className="text-sm font-semibold text-slate-900">
              Chunks for this section
            </h2>
            <p className="mt-1 text-xs text-slate-600">{heading}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Named chunk IDs on the item, transcript chunks overlapping discussion time, and
              document chunks on the item&apos;s source pages.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loading ? (
              <p className="text-sm text-slate-600">Loading chunks…</p>
            ) : error ? (
              <p className="text-sm text-red-700">{error}</p>
            ) : chunks.length === 0 ? (
              <p className="text-sm text-slate-600">
                No document or transcript chunks are linked to this section yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {chunks.map((chunk) => {
                  const isDoc = chunk.chunkKind === "document";
                  const meta = isDoc
                    ? chunk.pageNumbers && chunk.pageNumbers.length > 0
                      ? `Pages ${chunk.pageNumbers.join(", ")}`
                      : `Pages ${chunk.pageStart ?? "?"}–${chunk.pageEnd ?? "?"}`
                    : `${chunk.startTimestamp ?? "?"} – ${chunk.endTimestamp ?? "?"}`;
                  return (
                    <li key={chunk.id}>
                      <button
                        type="button"
                        onClick={() => setPreviewId(chunk.aiChunkId)}
                        className="flex w-full items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:border-slate-300 hover:bg-white"
                      >
                        <span className="mt-0.5 text-sm">{isDoc ? "📄" : "🎙️"}</span>
                        <span>
                          <span className="block font-mono text-xs font-semibold text-slate-900">
                            {chunk.aiChunkId}
                          </span>
                          <span className="block text-xs text-slate-600">{meta}</span>
                          {chunk.chunkLabel ? (
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {chunk.chunkLabel}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex justify-end border-t border-slate-100 px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300"
            >
              Close
            </button>
          </div>
        </div>
      </div>
      <ChunkPreviewModal
        open={Boolean(previewId)}
        meetingId={meetingId}
        chunkId={previewId}
        elevated
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}
