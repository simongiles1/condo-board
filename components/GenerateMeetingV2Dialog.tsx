"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { FileDropzone } from "@/components/FileDropzone";
import {
  buildTrimmedBoardPackage,
  type BoardPackageSelection,
} from "@/lib/pdf/board-package";

const BoardPackagePageSelector = dynamic(
  () =>
    import("@/components/BoardPackagePageSelector").then(
      (m) => m.BoardPackagePageSelector,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="md:col-span-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        Loading board package page picker…
      </div>
    ),
  },
);

function defaultTitleForDate(date: string) {
  return `Minutes - ${date}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function GenerateMeetingV2Dialog({ open, onClose }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [autoTitle, setAutoTitle] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [boardPackageSelection, setBoardPackageSelection] =
    useState<BoardPackageSelection | null>(null);

  const handleBoardPackageChange = useCallback(
    (value: BoardPackageSelection | null) => {
      setBoardPackageSelection(value);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose, open]);

  function resetForm() {
    setLoading(false);
    setError(null);
    setTitle("");
    setAutoTitle(null);
    setMeetingDate("");
    setFormKey((key) => key + 1);
    setBoardPackageSelection(null);
  }

  function handleClose() {
    if (loading) return;
    resetForm();
    onClose();
  }

  function handleMeetingDateChange(date: string) {
    setMeetingDate(date);
    if (!date) return;

    const nextTitle = defaultTitleForDate(date);
    setTitle((current) =>
      current === "" || current === autoTitle ? nextTitle : current,
    );
    setAutoTitle(nextTitle);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!boardPackageSelection || boardPackageSelection.selectedPages.length === 0) {
      setError("Select at least one page from the board package PDF.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    formData.delete("boardPackage");

    try {
      const trimmed = await buildTrimmedBoardPackage(boardPackageSelection);
      formData.append("boardPackage", trimmed);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not trim board package PDF.",
      );
      return;
    }

    try {
      setLoading(true);
      const response = await fetch("/api/v2/meetings/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Could not start the V2 meeting pipeline.",
        );
      }

      const payload = (await response.json()) as { id: string };
      resetForm();
      onClose();
      router.push(`/operations/meetings/v2/${payload.id}`);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unexpected server error.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        aria-labelledby="generate-meeting-v2-dialog-title"
        className="relative flex max-h-[min(90vh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="shrink-0 border-b border-slate-100 px-6 py-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Meetings V2
          </p>
          <h2
            id="generate-meeting-v2-dialog-title"
            className="mt-1 text-xl font-semibold text-slate-900"
          >
            Upload transcript and board package
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This creates a V2 workspace directly and starts the asynchronous
            extraction pipeline. It does not run the legacy V1 Gemini flow.
          </p>
        </div>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <form key={formKey} className="space-y-6" onSubmit={submit}>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold text-slate-800"
                  htmlFor="generate-v2-title"
                >
                  Meeting title *
                </label>
                <input
                  id="generate-v2-title"
                  name="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-semibold text-slate-800"
                  htmlFor="generate-v2-meeting-date"
                >
                  Meeting date *
                </label>
                <input
                  id="generate-v2-meeting-date"
                  name="meetingDate"
                  type="date"
                  value={meetingDate}
                  onChange={(event) => handleMeetingDateChange(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <FileDropzone
                name="transcript"
                label="Teams transcript (.vtt)"
                accept=".vtt,text/vtt"
                required
                helper="Required. Used as the factual transcript source."
              />

              <FileDropzone
                name="boardPackage"
                label="Board package (.pdf)"
                accept=".pdf,application/pdf"
                required
                helper="Required. Used as the factual document source."
              />

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                V2 upload does not use a reference minutes PDF. The pipeline
                ingests transcript + board package first, then builds reviewable
                agenda items asynchronously.
              </div>
            </div>

            <BoardPackagePageSelector
              inputName="boardPackage"
              onSelectionChange={handleBoardPackageChange}
            />

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Starting..." : "Create V2 Workspace"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
