"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";

type Props = {
  meetingId: string;
  meetingTitle: string;
  /** Navigate here after a successful delete (e.g. `/` from the workspace page). */
  redirectTo?: string;
};

export function DeleteMeetingButton({
  meetingId,
  meetingTitle,
  redirectTo,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setError(null);

    try {
      setBusy(true);

      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg =
          body && typeof body.error === "string"
            ? body.error
            : "Could not delete meeting workspace.";
        throw new Error(msg);
      }

      setOpen(false);

      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={`Delete workspace: ${meetingTitle}`}
        title="Delete workspace"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
      >
        <TrashIcon />
      </button>

      <ConfirmDialog
        open={open}
        title="Delete meeting workspace?"
        description={
          <>
            <p>
              This permanently removes <strong>{meetingTitle}</strong>, its
              action items, and uploaded transcript/PDF files.
            </p>
            {error ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete workspace"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!busy) {
            setOpen(false);
            setError(null);
          }
        }}
      />
    </>
  );
}

function TrashIcon() {
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
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
