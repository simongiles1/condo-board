"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AddDevNoteDialog,
  type DevNoteFormValues,
} from "@/components/AddDevNoteDialog";
import { DevNotesList, type DevNoteItem } from "@/components/DevNotesList";
import type { DevNoteStatus } from "@/lib/notes/status";

type Props = {
  items: DevNoteItem[];
};

async function parseApiResponse(
  res: Response,
  fallbackError: string,
): Promise<void> {
  const contentType = res.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    if (res.ok) return;

    if (res.status >= 500) {
      throw new Error(
        `${fallbackError} (server error ${res.status}). Try restarting the dev server.`,
      );
    }

    throw new Error(`${fallbackError} (unexpected response ${res.status}).`);
  }

  const payload = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;

  if (!res.ok) {
    throw new Error(payload?.error ?? `${fallbackError} (${res.status}).`);
  }
}

export function NotesPageClient({ items }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<DevNoteItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const openAddDialog = () => {
    setEditingNote(null);
    setDialogOpen(true);
  };

  const openEditDialog = (note: DevNoteItem) => {
    setEditingNote(note);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (!saving && !deleting) {
      setDialogOpen(false);
      setEditingNote(null);
    }
  };

  const handleStatusChange = async (
    note: DevNoteItem,
    status: DevNoteStatus,
  ) => {
    if (note.status === status) return;

    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          kind: note.kind,
          title: note.title,
          description: note.description,
          status,
        }),
      });

      await parseApiResponse(res, "Could not update status");

      router.refresh();
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!editingNote) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/${editingNote.id}`, {
        method: "DELETE",
        cache: "no-store",
      });

      await parseApiResponse(res, "Could not delete note");

      setDialogOpen(false);
      setEditingNote(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (values: DevNoteFormValues) => {
    setSaving(true);
    try {
      const res = await fetch(
        editingNote ? `/api/notes/${editingNote.id}` : "/api/notes",
        {
          method: editingNote ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(values),
        },
      );

      await parseApiResponse(res, "Could not save note");

      setDialogOpen(false);
      setEditingNote(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Product notes
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">
              Bugs &amp; features
            </h1>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              Track issues and ideas while testing the app. Paste screenshots
              directly from your clipboard when adding a note.
            </p>
          </div>
          <button
            type="button"
            onClick={openAddDialog}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700"
          >
            Add bug or feature
          </button>
        </div>

        <DevNotesList
          items={items}
          onSelectNote={openEditDialog}
          onStatusChange={handleStatusChange}
          statusBusy={statusUpdating}
        />
      </section>

      <AddDevNoteDialog
        key={editingNote?.id ?? "new"}
        open={dialogOpen}
        busy={saving || deleting}
        note={editingNote}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        onDelete={editingNote ? handleDelete : undefined}
      />
    </>
  );
}
