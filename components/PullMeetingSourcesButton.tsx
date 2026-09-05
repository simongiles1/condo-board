"use client";

import { useEffect, useState } from "react";

type PullResult = {
  pulled: Array<{ kind: string; relativePath: string; sizeBytes: number }>;
  skipped: Array<{ kind: string; reason: string }>;
  errors: Array<{ kind: string; error: string }>;
};

type Props = {
  meetingId: string;
  showWhenSourcesMissing?: boolean;
  sourcesMissing?: boolean;
  onPulled?: () => void;
  className?: string;
};

function formatKindLabel(kind: string): string {
  switch (kind) {
    case "board-package":
      return "board package";
    case "reference-pdf":
      return "reference PDF";
    case "transcript":
      return "transcript";
    default:
      return kind;
  }
}

export function PullMeetingSourcesButton({
  meetingId,
  showWhenSourcesMissing = false,
  sourcesMissing = false,
  onPulled,
  className = "",
}: Props) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const response = await fetch("/api/dev/remote-source-pull/config", {
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled) setEnabled(false);
          return;
        }
        const payload = (await response.json()) as { enabled?: boolean };
        if (!cancelled) setEnabled(Boolean(payload.enabled));
      } catch {
        if (!cancelled) setEnabled(false);
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;
  if (showWhenSourcesMissing && !sourcesMissing) return null;

  async function handlePull() {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/dev/meetings/${meetingId}/pull-sources`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | PullResult
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error : "Pull failed.");
      }

      const result = payload as PullResult;
      const pulledLabels = result.pulled.map((entry) => formatKindLabel(entry.kind));
      const errorLabels = result.errors.map(
        (entry) => `${formatKindLabel(entry.kind)}: ${entry.error}`,
      );

      if (pulledLabels.length > 0) {
        setMessage(`Pulled ${pulledLabels.join(", ")} from production.`);
        onPulled?.();
      } else if (errorLabels.length > 0) {
        setError(errorLabels.join(" "));
      } else if (result.skipped.length > 0) {
        setMessage("Source files are already on this machine.");
      } else {
        setMessage("No source files were registered for this meeting.");
      }
    } catch (pullError) {
      setError(pullError instanceof Error ? pullError.message : "Pull failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void handlePull()}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Pulling from production…" : "Pull source files from production"}
      </button>
      {message ? <p className="mt-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
