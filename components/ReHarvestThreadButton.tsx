"use client";

import { useState, useTransition } from "react";

import {
  buildExtractRunNotice,
  type ExtractRunWarning,
} from "@/lib/email-analysis/extract-run-warnings";
import {
  formatReharvestProgress,
  reharvestThread,
  type ReharvestKind,
} from "@/lib/email-analysis/reharvest-client";

export type HarvestRunMessage = {
  text: string;
  tone: "info" | "success" | "warning" | "error";
};

export function ReHarvestThreadButton({
  threadId,
  emailIds,
  kinds = ["contacts", "projects"],
  disabled = false,
  label,
  onComplete,
  onMessage,
}: {
  threadId?: string | null;
  emailIds?: string[];
  kinds?: ReharvestKind[];
  disabled?: boolean;
  label?: string;
  onComplete?: () => void;
  onMessage?: (message: HarvestRunMessage) => void;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  const canRun =
    Boolean(threadId?.trim()) ||
    (emailIds ?? []).some((id) => id.trim().length > 0);

  function publishNotice(warnings: ExtractRunWarning[], emailCount: number) {
    const kindLabel = kinds
      .map((kind) => (kind === "projects" ? "projects" : "contacts"))
      .join(" + ");
    const notice = buildExtractRunNotice({
      warnings,
      successTitle: `Re-harvested ${emailCount} email${emailCount === 1 ? "" : "s"} (${kindLabel}).`,
      successDetail:
        "Check Entities → Mentions for unresolved / confirmed rows. Refresh that tab if counts look stale.",
      problemTitle: `Re-harvest finished with problems (${kindLabel}).`,
    });
    onMessage?.({
      text:
        notice.lines.length > 0
          ? `${notice.title} ${notice.lines.join(" ")}`
          : notice.title,
      tone: notice.tone,
    });
  }

  function run() {
    start(async () => {
      setBusy(true);
      onMessage?.({
        text: "Re-harvesting contacts and projects (passes 1–4)…",
        tone: "info",
      });
      try {
        const result = await reharvestThread({
          threadId,
          emailIds,
          kinds,
          onProgress: (progress) => {
            onMessage?.({
              text: formatReharvestProgress(progress),
              tone: "info",
            });
          },
        });
        publishNotice(result.warnings, result.emailCount);
        onComplete?.();
      } catch (error) {
        onMessage?.({
          text:
            error instanceof Error ? error.message : "Re-harvest failed.",
          tone: "error",
        });
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <button
      type="button"
      disabled={disabled || pending || busy || !canRun}
      onClick={run}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
    >
      {busy || pending ? "Re-harvesting…" : (label ?? "Re-harvest thread")}
    </button>
  );
}
