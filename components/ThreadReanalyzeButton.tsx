"use client";

import { useState } from "react";

type Props = {
  emailIds: string[];
  onReanalyzeStart?: (emailIds: string[]) => void;
  onReanalyzeComplete?: () => void;
  onComplete?: () => void;
};

export function ThreadReanalyzeButton({
  emailIds,
  onReanalyzeStart,
  onReanalyzeComplete,
  onComplete,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function runReanalysis() {
    if (emailIds.length === 0) {
      setError("No emails found in this thread.");
      return;
    }

    setBusy(true);
    setError(null);
    onReanalyzeStart?.(emailIds);

    try {
      const response = await fetch("/api/analysis/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds, reprocess: true }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not re-analyze thread.");
      }

      setConfirmOpen(false);
      onComplete?.();
    } catch (reanalyzeError: unknown) {
      setError(
        reanalyzeError instanceof Error
          ? reanalyzeError.message
          : "Could not re-analyze thread.",
      );
    } finally {
      setBusy(false);
      onReanalyzeComplete?.();
    }
  }

  if (emailIds.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-800 transition hover:bg-teal-100 disabled:opacity-50"
      >
        Re-analyze thread
      </button>

      {confirmOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => {
              if (!busy) setConfirmOpen(false);
            }}
            disabled={busy}
            aria-label="Close dialog"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reanalyze-thread-title"
            className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h2
              id="reanalyze-thread-title"
              className="text-lg font-semibold text-slate-900"
            >
              Re-analyze this thread?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This runs AI analysis again on {emailIds.length} email
              {emailIds.length === 1 ? "" : "s"} in the thread and replaces
              extracted data with new results.
            </p>
            {error ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runReanalysis()}
                disabled={busy}
                className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Analyzing…" : "Re-analyze"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
