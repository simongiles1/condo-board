import { unlink } from "fs/promises";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { devNoteScreenshots, devNotes } from "@/lib/db/schema";

export async function deleteDevNote(
  id: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const db = getDb();

  const existing = await db
    .select()
    .from(devNotes)
    .where(eq(devNotes.id, id));

  if (existing.length === 0) {
    return { error: "Note not found", status: 404 };
  }

  const screenshots = await db
    .select()
    .from(devNoteScreenshots)
    .where(eq(devNoteScreenshots.noteId, id));

  await db.delete(devNotes).where(eq(devNotes.id, id));

  await Promise.all(
    screenshots.map(async (shot) => {
      try {
        await unlink(shot.filePath);
      } catch {
        // File may already be gone.
      }
    }),
  );

  return { ok: true };
}
