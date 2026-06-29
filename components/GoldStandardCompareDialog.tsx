"use client";

import { useEffect, useState } from "react";

import { FileDropzone } from "@/components/FileDropzone";
import type { GoldStandardValidationResult } from "@/lib/minutes/gold-standard-schema";

type Props = {
  open: boolean;
  meetingId: string | null;
  meetingTitle: string | null;
  onClose: () => void;
  onSuccess: (validation: GoldStandardValidationResult, aiUsageJson: string) => void;
};

export function GoldStandardCompareDialog({
  open,
  meetingId,
  meetingTitle,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  function handleClose() {
    if (loading) return;
    setError(null);
    setFormKey((key) => key + 1);
    onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!meetingId) return;

    setError(null);
    const formData = new FormData(event.currentTarget);

    try {
      setLoading(true);

      const response = await fetch(
        `/api/meetings/${meetingId}/compare-gold-standard`,
        {
          method: "POST",
          body: formData,
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Comparison failed.";
        throw new Error(message);
      }

      const validation = payload?.validation as
        | GoldStandardValidationResult
        | undefined;

      if (!validation) {
        throw new Error("Comparison returned no validation result.");
      }

      const aiUsageJson =
        typeof payload?.aiUsageJson === "string" ? payload.aiUsageJson : "";

      setFormKey((key) => key + 1);
      onSuccess(validation, aiUsageJson);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected server error.");
    } finally {
      setLoading(false);
    }
  }

  if (!open || !meetingId) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={handleClose}
        disabled={loading}
        aria-label="Close dialog"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gold-standard-compare-title"
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2
          id="gold-standard-compare-title"
          className="text-lg font-semibold text-slate-900"
        >
          Compare against gold standard
        </h2>
        {meetingTitle ? (
          <p className="mt-1 text-sm text-slate-600">{meetingTitle}</p>
        ) : null}
        <p className="mt-3 text-sm text-slate-600">
          Upload the board-approved official minutes PDF. The AI-generated
          minutes for this meeting are already on file — no transcript or other
          files are needed.
        </p>

        <form key={formKey} className="mt-5 space-y-4" onSubmit={submit}>
          <FileDropzone
            label="Gold standard minutes PDF"
            name="goldStandardPdf"
            accept="application/pdf,.pdf"
            hint="Approved official minutes for this meeting"
          />

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Comparing…" : "Compare"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
