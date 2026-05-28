"use client";

import { useEffect, useState } from "react";

import type { MergedVttCue } from "@/lib/parsers/vtt";
import { ReadableTranscriptView } from "@/components/ReadableTranscriptView";

type Tab = "readable" | "raw";

type Props = {
  open: boolean;
  meetingId: string;
  fileLabel: string;
  onClose: () => void;
};

export function VttViewerDialog({
  open,
  meetingId,
  fileLabel,
  onClose,
}: Props) {
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [readableContent, setReadableContent] = useState<string | null>(null);
  const [cues, setCues] = useState<MergedVttCue[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("readable");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadTranscript() {
      setLoading(true);
      setError(null);
      setRawContent(null);
      setReadableContent(null);
      setCues(null);
      setFileName(null);
      setCopied(false);
      setActiveTab("readable");

      try {
        const res = await fetch(`/api/meetings/${meetingId}/transcript`);

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? "Could not load transcript.");
        }

        const payload = (await res.json()) as {
          content: string;
          readable?: string;
          cues?: MergedVttCue[];
          fileName: string;
        };

        if (cancelled) return;

        setRawContent(payload.content);
        setReadableContent(payload.readable ?? "");
        setCues(payload.cues ?? []);
        setFileName(payload.fileName);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load transcript.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTranscript();

    return () => {
      cancelled = true;
    };
  }, [open, meetingId]);

  useEffect(() => {
    setCopied(false);
  }, [activeTab]);

  if (!open) return null;

  const isReadableTab = activeTab === "readable";
  const copyText = isReadableTab
    ? (readableContent ?? "")
    : (rawContent ?? "");
  const canCopy = Boolean(copyText.trim());
  const copyLabel = isReadableTab ? "readable transcript" : "VTT";

  async function handleCopy() {
    if (!canCopy) return;

    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

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
        aria-labelledby="vtt-viewer-title"
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2
            id="vtt-viewer-title"
            className="text-xl font-semibold text-slate-900"
          >
            Transcript
          </h2>
          <p className="mt-1 font-mono text-sm text-slate-600">
            {fileName ?? fileLabel}
          </p>

          {!loading && !error && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div
                className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
                role="tablist"
                aria-label="Transcript format"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isReadableTab}
                  onClick={() => setActiveTab("readable")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isReadableTab
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Readable
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isReadableTab}
                  onClick={() => setActiveTab("raw")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    !isReadableTab
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Raw VTT
                </button>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!canCopy}
                aria-label={
                  copied
                    ? "Copied"
                    : `Copy ${copyLabel}`
                }
                title={
                  copied
                    ? "Copied"
                    : `Copy ${copyLabel}`
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copied ? (
                  <CheckIcon className="text-emerald-600" />
                ) : (
                  <CopyIcon />
                )}
                <span className="hidden sm:inline">
                  {copied ? "Copied" : "Copy"}
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="text-sm text-slate-600">Loading transcript…</p>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {error}
            </div>
          ) : isReadableTab && cues && cues.length > 0 ? (
            <ReadableTranscriptView cues={cues} />
          ) : isReadableTab ? (
            <p className="text-sm text-slate-600">No transcript cues found.</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
              {rawContent}
            </pre>
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

function CopyIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`h-4 w-4 ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
