"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { MergedVttCue } from "@/lib/parsers/vtt";
import {
  vttToMergedCues,
  vttToReadableTranscript,
} from "@/lib/parsers/vtt";
import { ReadableTranscriptView } from "@/components/ReadableTranscriptView";
import { SearchHighlightedText } from "@/components/SearchHighlightedText";
import {
  findCueMatches,
  findTextMatches,
  scrollChildIntoContainer,
} from "@/lib/transcript/search";

type Tab = "readable" | "raw";

type Props = {
  open: boolean;
  fileLabel: string;
  onClose: () => void;
} & (
  | { meetingId: string; vttContent?: never; localFileName?: never }
  | { meetingId?: never; vttContent: string; localFileName?: string }
);

export function VttViewerDialog({
  open,
  meetingId,
  vttContent,
  localFileName,
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
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    function loadLocalTranscript(content: string, name: string) {
      setLoading(true);
      setError(null);
      setRawContent(null);
      setReadableContent(null);
      setCues(null);
      setFileName(null);
      setCopied(false);
      setActiveTab("readable");
      setSearchQuery("");
      setCurrentMatchIndex(0);

      setRawContent(content);
      setReadableContent(vttToReadableTranscript(content));
      setCues(vttToMergedCues(content));
      setFileName(name);
      setLoading(false);
    }

    async function loadRemoteTranscript() {
      setLoading(true);
      setError(null);
      setRawContent(null);
      setReadableContent(null);
      setCues(null);
      setFileName(null);
      setCopied(false);
      setActiveTab("readable");
      setSearchQuery("");
      setCurrentMatchIndex(0);

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

    if (vttContent != null) {
      loadLocalTranscript(vttContent, localFileName ?? fileLabel);
      return;
    }

    if (!meetingId) {
      setError("No transcript source provided.");
      setLoading(false);
      return;
    }

    void loadRemoteTranscript();

    return () => {
      cancelled = true;
    };
  }, [open, meetingId, vttContent, localFileName, fileLabel]);

  useEffect(() => {
    setCopied(false);
  }, [activeTab]);

  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery, activeTab]);

  const isReadableTab = activeTab === "readable";

  const cueMatches = useMemo(
    () => (cues ? findCueMatches(cues, searchQuery) : []),
    [cues, searchQuery],
  );

  const rawMatches = useMemo(() => {
    if (!rawContent || !searchQuery.trim()) return [];
    return findTextMatches(rawContent, searchQuery).map((match, index) => ({
      ...match,
      globalIndex: index,
    }));
  }, [rawContent, searchQuery]);

  const activeMatches = isReadableTab ? cueMatches : rawMatches;
  const totalMatches = activeMatches.length;

  useEffect(() => {
    if (!open || !searchQuery.trim() || totalMatches === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const safeIndex = Math.min(currentMatchIndex, totalMatches - 1);
    const mark = container.querySelector(
      `[data-match-index="${safeIndex}"]`,
    );
    if (mark instanceof HTMLElement) {
      scrollChildIntoContainer(container, mark);
    }
  }, [open, searchQuery, currentMatchIndex, totalMatches, activeTab]);

  useEffect(() => {
    if (currentMatchIndex >= totalMatches && totalMatches > 0) {
      setCurrentMatchIndex(0);
    }
  }, [currentMatchIndex, totalMatches]);

  if (!open) return null;
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

  function goToNextMatch() {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((index) => (index + 1) % totalMatches);
  }

  function goToPreviousMatch() {
    if (totalMatches === 0) return;
    setCurrentMatchIndex(
      (index) => (index - 1 + totalMatches) % totalMatches,
    );
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        goToPreviousMatch();
      } else {
        goToNextMatch();
      }
    }
  }

  const trimmedSearch = searchQuery.trim();
  const matchStatus =
    trimmedSearch.length === 0
      ? null
      : totalMatches === 0
        ? "No matches"
        : `${currentMatchIndex + 1} of ${totalMatches}`;

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

          {!loading && !error && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search transcript…"
                  aria-label="Search transcript"
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={goToPreviousMatch}
                  disabled={totalMatches === 0}
                  aria-label="Previous match"
                  title="Previous match (Shift+Enter)"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  onClick={goToNextMatch}
                  disabled={totalMatches === 0}
                  aria-label="Next match"
                  title="Next match (Enter)"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronDownIcon />
                </button>
                {matchStatus && (
                  <span
                    className={`min-w-[5.5rem] text-right text-xs tabular-nums ${
                      totalMatches === 0 ? "text-amber-700" : "text-slate-500"
                    }`}
                    aria-live="polite"
                  >
                    {matchStatus}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          ref={scrollContainerRef}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
        >
          {loading ? (
            <p className="text-sm text-slate-600">Loading transcript…</p>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {error}
            </div>
          ) : isReadableTab && cues && cues.length > 0 ? (
            <ReadableTranscriptView
              cues={cues}
              searchQuery={searchQuery}
              matches={cueMatches}
              currentMatchIndex={currentMatchIndex}
            />
          ) : isReadableTab ? (
            <p className="text-sm text-slate-600">No transcript cues found.</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
              {trimmedSearch ? (
                <SearchHighlightedText
                  text={rawContent ?? ""}
                  matches={rawMatches}
                  currentMatchIndex={currentMatchIndex}
                />
              ) : (
                rawContent
              )}
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

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
      />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
