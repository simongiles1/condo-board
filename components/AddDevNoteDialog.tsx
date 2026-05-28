import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  DEV_NOTE_STATUSES,
  DEV_NOTE_STATUS_LABELS,
  type DevNoteStatus,
} from "@/lib/notes/status";
import { MediaPreviewDialog } from "@/components/MediaPreviewDialog";

type NoteKind = "bug" | "feature";

type PendingScreenshot = {
  id: string;
  dataUrl: string;
};

type ExistingScreenshot = {
  id: string;
  url: string;
};

export type DevNoteFormValues = {
  kind: NoteKind;
  status: DevNoteStatus;
  title: string;
  description: string;
  screenshots: string[];
  removedScreenshotIds?: string[];
};

export type DevNoteDialogNote = {
  id: string;
  kind: NoteKind;
  status: DevNoteStatus;
  title: string;
  description: string;
  screenshots: Array<{ id: string }>;
};

type Props = {
  open: boolean;
  busy?: boolean;
  note?: DevNoteDialogNote | null;
  onClose: () => void;
  onSubmit: (values: DevNoteFormValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
};

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100";

function screenshotUrl(id: string) {
  return `/api/notes/screenshots/${id}`;
}

export function AddDevNoteDialog({
  open,
  busy = false,
  note = null,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const isEdit = note != null;

  const [kind, setKind] = useState<NoteKind>("bug");
  const [status, setStatus] = useState<DevNoteStatus>("open");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [existingScreenshots, setExistingScreenshots] = useState<
    ExistingScreenshot[]
  >([]);
  const [removedExistingIds, setRemovedExistingIds] = useState<string[]>([]);
  const [screenshots, setScreenshots] = useState<PendingScreenshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [previewScreenshot, setPreviewScreenshot] = useState<{
    url: string;
    label: string;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    if (note) {
      setKind(note.kind);
      setStatus(note.status);
      setTitle(note.title);
      setDescription(note.description);
      setExistingScreenshots(
        note.screenshots.map((shot) => ({
          id: shot.id,
          url: screenshotUrl(shot.id),
        })),
      );
      setRemovedExistingIds([]);
      setScreenshots([]);
    } else {
      setKind("bug");
      setStatus("open");
      setTitle("");
      setDescription("");
      setExistingScreenshots([]);
      setRemovedExistingIds([]);
      setScreenshots([]);
    }

    setError(null);
    setConfirmingDelete(false);
    setPreviewScreenshot(null);
  }, [open, note]);

  const addScreenshotFromFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      setScreenshots((current) => [
        ...current,
        { id: crypto.randomUUID(), dataUrl },
      ]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      let added = false;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        addScreenshotFromFile(file);
        added = true;
      }

      if (added) setError(null);
    },
    [addScreenshotFromFile],
  );

  const removeScreenshot = useCallback((id: string) => {
    setScreenshots((current) => current.filter((s) => s.id !== id));
  }, []);

  const removeExistingScreenshot = useCallback((id: string) => {
    setExistingScreenshots((current) => current.filter((s) => s.id !== id));
    setRemovedExistingIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (!trimmedDescription) {
      setError("Description is required.");
      return;
    }

    try {
      await onSubmit({
        kind,
        status,
        title: trimmedTitle,
        description: trimmedDescription,
        screenshots: screenshots.map((s) => s.dataUrl),
        removedScreenshotIds: isEdit ? removedExistingIds : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save note.");
    }
  };

  const handleConfirmDelete = async () => {
    if (!onDelete) return;
    setError(null);

    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete note.");
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
        aria-labelledby="add-dev-note-title"
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-100 px-6 py-5">
          <h2
            id="add-dev-note-title"
            className="text-xl font-semibold text-slate-900"
          >
            {isEdit ? "Edit" : "Add"} {kind === "bug" ? "bug" : "feature"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {isEdit
              ? "Update this note or add more screenshots from your clipboard."
              : "Record an issue or idea with optional screenshots from your clipboard."}
          </p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="shrink-0 space-y-1.5">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Type
                </span>
                <div
                  className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                  role="group"
                  aria-label="Bug or feature"
                >
                  <button
                    type="button"
                    onClick={() => setKind("bug")}
                    disabled={busy}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                      kind === "bug"
                        ? "bg-white text-red-800 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Bug
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind("feature")}
                    disabled={busy}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                      kind === "feature"
                        ? "bg-white text-teal-800 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Feature
                  </button>
                </div>
              </div>

              <label className="min-w-[10rem] shrink-0 space-y-1.5">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as DevNoteStatus)}
                  disabled={busy}
                  className={INPUT_CLASS}
                >
                  {DEV_NOTE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {DEV_NOTE_STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-[12rem] flex-1 space-y-1.5">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Title
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short summary"
                  disabled={busy}
                  className={INPUT_CLASS}
                  autoFocus
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Description
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened or what should we build?"
                disabled={busy}
                rows={4}
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>

            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Screenshots{" "}
                <span className="normal-case font-normal">(optional)</span>
              </span>
              <div
                tabIndex={0}
                onPaste={handlePaste}
                className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/80 px-4 py-5 text-center text-sm text-slate-600 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <span className="font-medium text-slate-800">
                  Click here, then paste
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Ctrl+V (or Cmd+V) to add a screenshot from the clipboard
                </span>
              </div>

              {existingScreenshots.length > 0 || screenshots.length > 0 ? (
                <ul className="grid grid-cols-2 gap-2">
                  {existingScreenshots.map((shot) => (
                    <li
                      key={shot.id}
                      className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewScreenshot({
                            url: shot.url,
                            label: "Screenshot",
                          })
                        }
                        className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
                        aria-label="View screenshot full size"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={shot.url}
                          alt=""
                          className="h-28 w-full cursor-zoom-in object-cover object-top"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeExistingScreenshot(shot.id)}
                        disabled={busy}
                        className="absolute right-1 top-1 rounded bg-slate-900/70 px-2 py-0.5 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                  {screenshots.map((shot) => (
                    <li
                      key={shot.id}
                      className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewScreenshot({
                            url: shot.dataUrl,
                            label: "New screenshot",
                          })
                        }
                        className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
                        aria-label="View screenshot full size"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={shot.dataUrl}
                          alt=""
                          className="h-28 w-full cursor-zoom-in object-cover object-top"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeScreenshot(shot.id)}
                        disabled={busy}
                        className="absolute right-1 top-1 rounded bg-slate-900/70 px-2 py-0.5 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {error ? (
            <p className="mx-6 mb-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {confirmingDelete ? (
            <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-900">
                Delete this {kind === "bug" ? "bug" : "feature"}?
              </p>
              <p className="mt-1 text-sm text-red-800">
                <strong>{title.trim() || note?.title}</strong> will be
                permanently removed. This cannot be undone.
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                  className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  disabled={busy}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-4">
            {isEdit && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirmingDelete(true);
                }}
                disabled={busy || confirmingDelete}
                className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap justify-end gap-2">
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
                disabled={busy || confirmingDelete}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>

      <MediaPreviewDialog
        open={previewScreenshot != null}
        title={previewScreenshot?.label ?? "Screenshot"}
        onClose={() => setPreviewScreenshot(null)}
      >
        {previewScreenshot ? (
          <div className="flex min-h-[50dvh] items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewScreenshot.url}
              alt=""
              className="max-h-[75dvh] max-w-full rounded-lg object-contain shadow-sm"
            />
          </div>
        ) : null}
      </MediaPreviewDialog>
    </div>,
    document.body,
  );
}
