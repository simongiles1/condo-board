"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DeleteTarget = "db" | "gmail" | "both";

type Props = {
  emailId: string;
  subject: string;
  source: string;
  /** Navigate here when the parent thread is removed entirely. */
  redirectOnThreadDeleted?: string;
  onDeleted?: (emailId: string) => void;
};

export function DeleteEmailButton({
  emailId,
  subject,
  source,
  redirectOnThreadDeleted = "/knowledge/emails",
  onDeleted,
}: Props) {
  const router = useRouter();
  const canDeleteFromGmail = source === "dedicated";

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<DeleteTarget>("db");

  function resetForm() {
    setTarget("db");
    setError(null);
  }

  function targetToOptions(value: DeleteTarget) {
    return {
      deleteFromDb: value === "db" || value === "both",
      deleteFromGmail: value === "gmail" || value === "both",
    };
  }

  async function confirmDelete() {
    setError(null);

    try {
      setBusy(true);

      const res = await fetch(`/api/email/messages/${emailId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetToOptions(target)),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          body && typeof body.error === "string"
            ? body.error
            : "Could not delete email.";
        throw new Error(msg);
      }

      if (body?.errors?.length) {
        throw new Error(body.errors.join(" "));
      }

      if (!body?.deletedFromDb && !body?.deletedFromGmail) {
        throw new Error("Nothing was deleted.");
      }

      setOpen(false);
      resetForm();
      onDeleted?.(emailId);

      if (body?.threadDeleted) {
        router.push(redirectOnThreadDeleted);
        router.refresh();
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
          resetForm();
          setOpen(true);
        }}
        aria-label={`Delete email: ${subject}`}
        title="Delete email"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
      >
        <TrashIcon />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => {
              if (!busy) {
                setOpen(false);
                resetForm();
              }
            }}
            disabled={busy}
            aria-label="Close dialog"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-email-dialog-title"
            className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h2
              id="delete-email-dialog-title"
              className="text-lg font-semibold text-slate-900"
            >
              Delete email?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Choose where to remove <strong>{subject}</strong>. Personal Gmail
              backfill copies are never touched.
            </p>

            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">Delete target</legend>

              <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 has-checked:border-teal-300 has-checked:bg-teal-50">
                <input
                  type="radio"
                  name={`delete-target-${emailId}`}
                  className="mt-0.5"
                  checked={target === "db"}
                  onChange={() => setTarget("db")}
                  disabled={busy}
                />
                <span>
                  <span className="font-medium">Service database only</span>
                  <span className="mt-0.5 block text-slate-600">
                    Remove from this app. The dedicated Gmail copy stays put and
                    will not be re-imported.
                  </span>
                </span>
              </label>

              {canDeleteFromGmail ? (
                <>
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 has-checked:border-teal-300 has-checked:bg-teal-50">
                    <input
                      type="radio"
                      name={`delete-target-${emailId}`}
                      className="mt-0.5"
                      checked={target === "gmail"}
                      onChange={() => setTarget("gmail")}
                      disabled={busy}
                    />
                    <span>
                      <span className="font-medium">Dedicated Gmail only</span>
                      <span className="mt-0.5 block text-slate-600">
                        Move to Trash in the dedicated condo inbox. Keeps the
                        copy in this app.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 has-checked:border-teal-300 has-checked:bg-teal-50">
                    <input
                      type="radio"
                      name={`delete-target-${emailId}`}
                      className="mt-0.5"
                      checked={target === "both"}
                      onChange={() => setTarget("both")}
                      disabled={busy}
                    />
                    <span>
                      <span className="font-medium">Both</span>
                      <span className="mt-0.5 block text-slate-600">
                        Remove from the app and move to Trash in dedicated
                        Gmail.
                      </span>
                    </span>
                  </label>
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  Gmail delete is not available for personal backfill imports.
                </p>
              )}
            </fieldset>

            {error ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!busy) {
                    setOpen(false);
                    resetForm();
                  }
                }}
                disabled={busy}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={busy}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
