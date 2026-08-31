"use client";

import type { ExtractRunNotice } from "@/lib/email-analysis/extract-run-warnings";

const TONE_CLASS: Record<ExtractRunNotice["tone"], string> = {
  success:
    "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950",
  warning:
    "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950",
  error: "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800",
};

const TITLE_CLASS: Record<ExtractRunNotice["tone"], string> = {
  success: "font-medium text-emerald-950",
  warning: "font-medium text-amber-950",
  error: "font-medium text-red-900",
};

const LINE_CLASS: Record<ExtractRunNotice["tone"], string> = {
  success: "mt-1 text-emerald-900",
  warning: "mt-1 text-amber-900",
  error: "mt-1 text-red-800",
};

export function HarvestRunNotice({
  notice,
  onDismiss,
}: {
  notice: ExtractRunNotice | null;
  onDismiss?: () => void;
}) {
  if (!notice) return null;

  return (
    <div className={TONE_CLASS[notice.tone]} role={notice.tone === "error" ? "alert" : "status"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={TITLE_CLASS[notice.tone]}>{notice.title}</p>
          {notice.lines.length > 0 ? (
            <ul className={`list-disc space-y-1 pl-5 ${LINE_CLASS[notice.tone]}`}>
              {notice.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-xs font-medium underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function harvestMessageClassName(
  tone: "info" | "success" | "warning" | "error",
): string {
  if (tone === "error") return "text-sm text-red-700";
  if (tone === "warning") return "text-sm text-amber-800";
  if (tone === "success") return "text-sm text-emerald-800";
  return "text-sm text-slate-600";
}
