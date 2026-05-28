import { asc, desc, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { devNoteScreenshots, devNotes } from "@/lib/db/schema";
import type { DevNoteStatus } from "@/lib/notes/status";

export type DevNoteScreenshot = {
  id: string;
  mimeType: string;
  sortOrder: number;
};

export type DevNoteRow = {
  id: string;
  kind: "bug" | "feature";
  status: DevNoteStatus;
  title: string;
  description: string;
  createdAt: string;
  screenshots: DevNoteScreenshot[];
};

export async function fetchDevNotes(): Promise<DevNoteRow[]> {
  const db = getDb();

  const notes = await db
    .select()
    .from(devNotes)
    .orderBy(desc(devNotes.createdAt));

  if (notes.length === 0) return [];

  const noteIds = notes.map((n) => n.id);
  const screenshots = await db
    .select()
    .from(devNoteScreenshots)
    .where(inArray(devNoteScreenshots.noteId, noteIds))
    .orderBy(asc(devNoteScreenshots.sortOrder));

  const byNote = new Map<string, DevNoteScreenshot[]>();
  for (const shot of screenshots) {
    const list = byNote.get(shot.noteId) ?? [];
    list.push({
      id: shot.id,
      mimeType: shot.mimeType,
      sortOrder: shot.sortOrder,
    });
    byNote.set(shot.noteId, list);
  }

  return notes.map((note) => ({
    id: note.id,
    kind: note.kind,
    status: note.status,
    title: note.title,
    description: note.description,
    createdAt: note.createdAt,
    screenshots: byNote.get(note.id) ?? [],
  }));
}
