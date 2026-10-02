"use client";

import { useState } from "react";

import type { MergedVttCue } from "@/lib/parsers/vtt";
import { formatReadableTranscriptForCueIndexes } from "@/lib/parsers/vtt";

type Props = {
  cues: MergedVttCue[];
  cueIndexes: readonly number[];
  /** Accessible name suffix, e.g. section title. */
  sectionLabel?: string;
  className?: string;
};

/** Copies one transcript segment in readable `[time] Speaker: text` form. */
export function TranscriptSegmentCopyButton({
  cues,
  cueIndexes,
  sectionLabel,
  className = "",
}: Props) {
  const [copied, setCopied] = useState(false);
  const text = formatReadableTranscriptForCueIndexes(cues, cueIndexes);
  const canCopy = Boolean(text.trim());
  const ariaLabel = sectionLabel
    ? copied
      ? `Copied segment: ${sectionLabel}`
      : `Copy segment transcript: ${sectionLabel}`
    : copied
      ? "Copied segment transcript"
      : "Copy segment transcript";

  async function handleCopy(event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    if (!canCopy) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      disabled={!canCopy}
      title={ariaLabel}
      aria-label={ariaLabel}
      onClick={(event) => void handleCopy(event)}
      className={`inline-flex shrink-0 items-center justify-center rounded p-0.5 text-current opacity-70 transition hover:bg-black/5 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function CopyIcon({ className }: { className?: string }) {
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
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
