"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FileDropzone } from "@/components/FileDropzone";
import {
  appendMainRunModelsToFormData,
  loadModelSettings,
} from "@/lib/settings/model-settings";

function defaultTitleForDate(date: string) {
  return `Minutes - ${date}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function GenerateMeetingDialog({ open, onClose }: Props) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [autoTitle, setAutoTitle] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState("");
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

  function resetForm() {
    setLoading(false);
    setError(null);
    setTitle("");
    setAutoTitle(null);
    setMeetingDate("");
    setFormKey((key) => key + 1);
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

    const formData = new FormData(event.currentTarget);
    appendMainRunModelsToFormData(formData, loadModelSettings());

    try {
      setLoading(true);

      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Gemini refused to finish.";
        throw new Error(message);
      }

      const payload = (await response.json()) as {
        id: string;
        warnings?: {
          minuteWarnings?: string[];
          todoWarnings?: string[];
        };
      };

      const minuteWarnings = payload.warnings?.minuteWarnings ?? [];
      const todoWarnings = payload.warnings?.todoWarnings ?? [];
      const warningLines = [...minuteWarnings, ...todoWarnings];

      if (warningLines.length > 0) {
        sessionStorage.setItem(
          `meeting-warnings:${payload.id}`,
          JSON.stringify(warningLines),
        );
      }

      resetForm();
      onClose();
      router.push(`/meetings/${payload.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected server error.");
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
        aria-labelledby="generate-meeting-dialog-title"
        className="relative flex max-h-[min(90vh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="shrink-0 border-b border-slate-100 px-6 py-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Phase 1 — AI ingestion
          </p>
          <h2
            id="generate-meeting-dialog-title"
            className="mt-1 text-xl font-semibold text-slate-900"
          >
            Drop in the Teams transcript and reference PDF
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Originals land in <code>./uploads</code>; the database holds metadata and
            editable outputs. Set <code>GEMINI_API_KEY</code> in{" "}
            <code>.env.local</code> before running the dual prompts.
          </p>
        </div>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <form
            key={formKey}
            className="space-y-6"
            onSubmit={submit}
          >
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold text-slate-800"
                  htmlFor="generate-title"
                >
                  Meeting title *
                </label>
                <input
                  required
                  id="generate-title"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Minutes - 2026-05-19"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold text-slate-800"
                  htmlFor="generate-meetingDate"
                >
                  Meeting date *
                </label>
                <input
                  required
                  id="generate-meetingDate"
                  type="date"
                  name="meetingDate"
                  value={meetingDate}
                  onChange={(e) => handleMeetingDateChange(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                />
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <FileDropzone
                name="transcript"
                accept=".vtt,text/vtt"
                label="Microsoft Teams transcript"
                hint="Teams → Export → WebVTT (.vtt)"
              />
              <FileDropzone
                name="referencePdf"
                accept=".pdf,application/pdf"
                label="Reference minutes PDF"
                hint="Prefer text-selectable exports for precedent."
              />
            </div>

            <aside className="rounded-2xl bg-slate-900 p-5 text-white">
              <h3 className="text-sm font-semibold">Compliance reminders</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                <li>
                  Facts must originate from the readable transcript—not from
                  PDF precedent.
                </li>
                <li>
                  Motions obey the mandated template with sanctioned fallback
                  mover names when speakers are unnamed.
                </li>
                <li>
                  Sensitive topics route to ADDENDUM TO THE MINUTES /
                  RESTRICTED RECORDS if explicitly voiced.
                </li>
                <li>
                  Gemini warnings log to stdout; review motions + headings
                  before finalize.
                </li>
              </ul>
            </aside>

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow-lg transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Gemini sequential call (minutes → to-dos)…"
                  : "Run Gemini pipelines"}
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="text-sm font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
