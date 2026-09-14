"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FormDialog } from "@/components/FormDialog";

type Props = {
  open: boolean;
  meetingId: string;
  meetingTitle: string;
  onClose: () => void;
};

export function DuplicateMeetingV2Dialog({
  open,
  meetingId,
  meetingTitle,
  onClose,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(`${meetingTitle} (copy)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(`${meetingTitle} (copy)`);
    setError(null);
  }, [open, meetingTitle]);

  async function submitDuplicate() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("A name is required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v2/meetings/${meetingId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      const body = (await response.json().catch(() => null)) as
        | { id?: string; error?: string }
        | null;
      if (!response.ok || !body?.id) {
        throw new Error(body?.error || "Could not duplicate meeting workspace.");
      }
      onClose();
      router.push(`/operations/meetings/v2/${body.id}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not duplicate meeting workspace.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      title="Duplicate meeting minutes"
      description="Creates a copy with the same files and generated agenda, reset to agenda approval. Minutes-stage work is not copied."
      submitLabel="Duplicate"
      busyLabel="Duplicating…"
      busy={busy}
      error={error}
      onClose={() => {
        if (!busy) onClose();
      }}
      onSubmit={() => {
        void submitDuplicate();
      }}
    >
      <label className="block text-sm font-medium text-slate-700" htmlFor="duplicate-meeting-title">
        Meeting minutes name
      </label>
      <input
        id="duplicate-meeting-title"
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-teal-600/20 focus:border-teal-500 focus:ring-2"
        autoFocus
      />
    </FormDialog>
  );
}

export function DuplicateMeetingMenuIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7.5h9.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 16.5H6.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H16"
      />
    </svg>
  );
}
