"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  markdown: string;
  /** When set, show a format menu with Markdown and JSON copy options. */
  json?: string | null;
  disabled?: boolean;
};

type CopyFormat = "markdown" | "json";

function formatJsonForClipboard(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function CopyMarkdownButton({ markdown, json, disabled }: Props) {
  const [copied, setCopied] = useState<CopyFormat | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const hasJson = Boolean(json?.trim());
  const showFormatMenu = hasJson;
  const canCopyMarkdown = Boolean(markdown.trim());
  const canCopy = showFormatMenu ? canCopyMarkdown || hasJson : canCopyMarkdown;

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function copy(format: CopyFormat) {
    const text =
      format === "json"
        ? formatJsonForClipboard(json ?? "")
        : markdown;

    if (!text.trim()) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(format);
      setMenuOpen(false);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  if (!showFormatMenu) {
    return (
      <button
        type="button"
        onClick={() => copy("markdown")}
        disabled={disabled || !canCopyMarkdown}
        aria-label={copied === "markdown" ? "Copied" : "Copy markdown"}
        title={copied === "markdown" ? "Copied" : "Copy markdown"}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {copied === "markdown" ? (
          <CheckIcon className="text-emerald-600" />
        ) : (
          <CopyIcon />
        )}
      </button>
    );
  }

  const copiedLabel =
    copied === "json" ? "JSON copied" : copied === "markdown" ? "Markdown copied" : null;

  return (
    <div ref={rootRef} className="relative inline-flex">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => copy("markdown")}
          disabled={disabled || !canCopyMarkdown}
          aria-label={copiedLabel ?? "Copy as Markdown"}
          title={copiedLabel ?? "Copy as Markdown"}
          className="inline-flex h-8 w-8 items-center justify-center text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copied ? (
            <CheckIcon className="text-emerald-600" />
          ) : (
            <CopyIcon />
          )}
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          disabled={disabled || !canCopy}
          aria-label="Copy format options"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="inline-flex h-8 w-7 items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronDownIcon className={menuOpen ? "rotate-180" : ""} />
        </button>
      </div>

      {menuOpen ? (
        <div
          role="menu"
          aria-label="Copy format"
          className="absolute right-0 top-[calc(100%+0.375rem)] z-20 min-w-[11rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!canCopyMarkdown}
            onClick={() => copy("markdown")}
            className="flex w-full px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy as Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasJson}
            onClick={() => copy("json")}
            className="flex w-full px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy as JSON
          </button>
        </div>
      ) : null}
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

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`h-3.5 w-3.5 transition ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
