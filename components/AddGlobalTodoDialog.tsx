"use client";

import { useEffect, useState } from "react";

type FormState = {
  assignee: string;
  role: string;
  description: string;
  deadline: string;
};

const EMPTY_FORM: FormState = {
  assignee: "",
  role: "",
  description: "",
  deadline: "",
};

type Props = {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (values: {
    assignee: string;
    role: string;
    description: string;
    deadline: string | null;
  }) => void | Promise<void>;
};

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100";

export function AddGlobalTodoDialog({
  open,
  busy = false,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setError(null);
  }, [open]);

  if (!open) return null;

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const assignee = form.assignee.trim();
    const role = form.role.trim();
    const description = form.description.trim();
    const deadline = form.deadline.trim();

    if (!assignee) {
      setError("Assignee is required.");
      return;
    }
    if (!description) {
      setError("Description is required.");
      return;
    }

    try {
      await onSubmit({
        assignee,
        role: role || "Board member",
        description,
        deadline: deadline || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add todo.");
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
        aria-labelledby="add-global-todo-title"
        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2
            id="add-global-todo-title"
            className="text-xl font-semibold text-slate-900"
          >
            Add new to-do
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Create a standalone item on the board-wide global checklist.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5">
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Assignee
              </span>
              <input
                type="text"
                value={form.assignee}
                onChange={(e) => update("assignee", e.target.value)}
                placeholder="e.g. Shawna Greenspan"
                disabled={busy}
                className={INPUT_CLASS}
                autoFocus
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Role
              </span>
              <input
                type="text"
                value={form.role}
                onChange={(e) => update("role", e.target.value)}
                placeholder="e.g. Board, Management"
                disabled={busy}
                className={INPUT_CLASS}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Description
              </span>
              <textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="What needs to be done?"
                disabled={busy}
                rows={4}
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Deadline <span className="normal-case font-normal">(optional)</span>
              </span>
              <input
                type="text"
                value={form.deadline}
                onChange={(e) => update("deadline", e.target.value)}
                placeholder="e.g. 2026-06-01 or before next meeting"
                disabled={busy}
                className={INPUT_CLASS}
              />
            </label>
          </div>

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
              {busy ? "Adding…" : "Add to-do"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
