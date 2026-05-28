"use client";

import { useState } from "react";

import { loadModelSettings } from "@/lib/settings/model-settings";

type Props = {
  meetingId: string;
  todosMarkdown: string;
  disabled?: boolean;
  onSuccess?: (result: {
    message: string;
    todosContent: string;
    globalTodosMergedAt: string;
  }) => void;
  onError?: (message: string) => void;
};

export function MergeToGlobalTodosButton({
  meetingId,
  todosMarkdown,
  disabled,
  onSuccess,
  onError,
}: Props) {
  const [loading, setLoading] = useState(false);

  const merge = async () => {
    if (!todosMarkdown.trim()) {
      onError?.("Save a todo list before merging.");
      return;
    }

    setLoading(true);
    try {
      const settings = loadModelSettings();
      const res = await fetch(
        `/api/meetings/${meetingId}/merge-to-global-todos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            todosContent: todosMarkdown,
            modelTodos: settings.mainTodos,
          }),
        },
      );

      const payload = (await res.json()) as {
        error?: string;
        details?: string[];
        todosContent?: string;
        globalTodosMergedAt?: string;
        changes?: {
          added: number;
          updated: number;
          unchanged: number;
          deduplicated: number;
        };
        count?: number;
      };

      if (!res.ok) {
        const detail = payload.details?.join(" ") ?? "";
        throw new Error(
          [payload.error, detail].filter(Boolean).join(" ") ||
            "Merge failed",
        );
      }

      const changes = payload.changes;
      const parts: string[] = [];
      if (changes) {
        if (changes.added) parts.push(`${changes.added} added`);
        if (changes.updated) parts.push(`${changes.updated} updated`);
        if (changes.deduplicated) parts.push(`${changes.deduplicated} deduplicated`);
        if (changes.unchanged) parts.push(`${changes.unchanged} unchanged`);
      }

      onSuccess?.({
        message: parts.length
          ? `Merged to global todos — ${parts.join(", ")}.`
          : `Merged to global todos (${payload.count ?? 0} total).`,
        todosContent: payload.todosContent ?? todosMarkdown,
        globalTodosMergedAt: payload.globalTodosMergedAt ?? new Date().toISOString(),
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void merge()}
      disabled={disabled || loading || !todosMarkdown.trim()}
      title="Use AI to merge this meeting's todos into the board-wide global checklist"
      className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-900 hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Merging…" : "Merge to global todos"}
    </button>
  );
}
