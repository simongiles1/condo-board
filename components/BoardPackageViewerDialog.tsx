"use client";

import { useEffect, useState } from "react";

type BoardPackageMeta = {
  fileName: string;
  pageCount: number | null;
  sizeBytes: number | null;
  available: boolean;
  source: "file" | "metadata";
};

type Props = {
  open: boolean;
  meetingId: string;
  onClose: () => void;
};

export function BoardPackageViewerDialog({ open, meetingId, onClose }: Props) {
  const [meta, setMeta] = useState<BoardPackageMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadMeta() {
      setLoading(true);
      setError(null);
      setMeta(null);

      try {
        const res = await fetch(`/api/meetings/${meetingId}/board-package?meta=1`);
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Could not load board package.");
        }

        const payload = (await res.json()) as BoardPackageMeta;
        if (cancelled) return;
        setMeta(payload);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load board package.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMeta();

    return () => {
      cancelled = true;
    };
  }, [open, meetingId]);

  if (!open) return null;

  const pdfUrl = `/api/meetings/${meetingId}/board-package`;
  const sizeLabel =
    meta?.sizeBytes != null
      ? meta.sizeBytes >= 1_048_576
        ? `${(meta.sizeBytes / 1_048_576).toFixed(1)} MB`
        : `${Math.max(1, Math.round(meta.sizeBytes / 1024))} KB`
      : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-package-viewer-title"
        className="relative flex max-h-[92vh] w-full max-w-5xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2
                id="board-package-viewer-title"
                className="text-xl font-semibold text-slate-900"
              >
                Board Package
              </h2>
              <p className="mt-1 font-mono text-sm text-slate-600">
                {meta?.fileName ?? "board-package.pdf"}
              </p>
              {meta ? (
                <p className="mt-2 text-sm text-slate-500">
                  {meta.pageCount != null ? `${meta.pageCount} pages` : "Page count unknown"}
                  {sizeLabel ? ` · ${sizeLabel}` : ""}
                </p>
              ) : null}
            </div>
            {meta?.available ? (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                Open in new tab
              </a>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
          {loading ? (
            <p className="text-sm text-slate-600">Loading board package…</p>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {error}
            </div>
          ) : meta?.available ? (
            <iframe
              title={`Board package: ${meta.fileName}`}
              src={pdfUrl}
              className="h-[min(70vh,720px)] w-full rounded-xl border border-slate-200 bg-slate-50"
            />
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              The uploaded board package PDF is not stored on this server. Open the meeting on the
              environment where it was uploaded to preview the file.
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
