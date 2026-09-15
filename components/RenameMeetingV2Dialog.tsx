"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FormDialog } from "@/components/FormDialog";

type Props = {
  open: boolean;
  meetingId: string;
  meetingTitle: string;
  onClose: () => void;
  onRenamed?: () => void;
};

export function RenameMeetingV2Dialog({
  open,
  meetingId,
  meetingTitle,
  onClose,
  onRenamed,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(meetingTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(meetingTitle);
    setError(null);
  }, [open, meetingTitle]);

  async function submitRename() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("A name is required.");
      return;
    }

    if (nextTitle === meetingTitle.trim()) {
      onClose();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      const body = (await response.json().catch(() => null)) as
        | { title?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error || "Could not rename meeting workspace.");
      }
      onClose();
      onRenamed?.();
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not rename meeting workspace.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      title="Rename workspace"
      description="Updates the display name for this meeting workspace."
      submitLabel="Save name"
      busyLabel="Saving…"
      busy={busy}
      error={error}
      onClose={() => {
        if (!busy) onClose();
      }}
      onSubmit={() => {
        void submitRename();
      }}
    >
      <label className="block text-sm font-medium text-slate-700" htmlFor="rename-meeting-title">
        Workspace name
      </label>
      <input
        id="rename-meeting-title"
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-teal-600/20 focus:border-teal-500 focus:ring-2"
        autoFocus
      />
    </FormDialog>
  );
}

export function RenameMeetingMenuIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
      />
    </svg>
  );
}
