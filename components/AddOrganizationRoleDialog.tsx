"use client";

import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (label: string) => void | Promise<void>;
};

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100";

export function AddOrganizationRoleDialog({
  open,
  busy = false,
  onClose,
  onSubmit,
}: Props) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setError(null);
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmed = label.trim();
    if (!trimmed) {
      setError("Role name is required.");
      return;
    }

    try {
      await onSubmit(trimmed);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not add organization role.",
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={busy ? undefined : onClose}
        aria-label="Close dialog"
        disabled={busy}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-organization-role-title"
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2
            id="add-organization-role-title"
            className="text-xl font-semibold text-slate-900"
          >
            Add organization role
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Create a new role for classifying organizations during entity review.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Role name
            </span>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Insurance broker"
              disabled={busy}
              className={INPUT_CLASS}
              autoFocus
            />
          </label>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Adding…" : "Add role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
