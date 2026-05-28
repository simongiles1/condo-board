export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { unlink } from "fs/promises";

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { devNoteScreenshots, devNotes } from "@/lib/db/schema";
import { fetchDevNotes } from "@/lib/notes/fetch-notes";
import { deleteDevNote } from "@/lib/notes/delete-dev-note";
import { saveScreenshotFromDataUrl } from "@/lib/notes/screenshots";
import { parseDevNoteStatus } from "@/lib/notes/status";

type RouteContext = { params: Promise<{ id: string }> };

type PatchBody = {
  kind?: string;
  status?: string;
  title?: string;
  description?: string;
  screenshots?: string[];
  removedScreenshotIds?: string[];
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    let body: PatchBody;

    try {
      body = (await request.json()) as PatchBody;
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON payload" },
        { status: 400 },
      );
    }

    const kind =
      body.kind === "feature" ? "feature" : body.kind === "bug" ? "bug" : null;
    const status = parseDevNoteStatus(body.status);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const screenshotUrls = Array.isArray(body.screenshots)
      ? body.screenshots.filter((s): s is string => typeof s === "string")
      : [];
    const removedScreenshotIds = Array.isArray(body.removedScreenshotIds)
      ? body.removedScreenshotIds.filter((s): s is string => typeof s === "string")
      : [];

    if (!kind) {
      return NextResponse.json(
        { error: "kind must be bug or feature" },
        { status: 400 },
      );
    }
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 },
      );
    }
    if (body.status !== undefined && !status) {
      return NextResponse.json(
        { error: "status must be open, closed, in_progress, or deferred" },
        { status: 400 },
      );
    }

    const db = getDb();

    const [existing] = await db
      .select()
      .from(devNotes)
      .where(eq(devNotes.id, id));

    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    await db
      .update(devNotes)
      .set({
        kind,
        title,
        description,
        ...(status ? { status } : {}),
      })
      .where(eq(devNotes.id, id));

    if (removedScreenshotIds.length > 0) {
      const toRemove = await db
        .select()
        .from(devNoteScreenshots)
        .where(
          and(
            eq(devNoteScreenshots.noteId, id),
            inArray(devNoteScreenshots.id, removedScreenshotIds),
          ),
        );

      if (toRemove.length > 0) {
        await db
          .delete(devNoteScreenshots)
          .where(inArray(devNoteScreenshots.id, toRemove.map((s) => s.id)));

        await Promise.all(
          toRemove.map(async (shot) => {
            try {
              await unlink(shot.filePath);
            } catch {
              // File may already be gone.
            }
          }),
        );
      }
    }

    const now = new Date().toISOString();
    const existingShots = await db
      .select()
      .from(devNoteScreenshots)
      .where(eq(devNoteScreenshots.noteId, id));

    const nextSortOrder =
      existingShots.length > 0
        ? Math.max(...existingShots.map((s) => s.sortOrder)) + 1
        : 0;

    const newScreenshots: Array<{
      id: string;
      noteId: string;
      filePath: string;
      mimeType: string;
      sortOrder: number;
      createdAt: string;
    }> = [];

    for (let i = 0; i < screenshotUrls.length; i++) {
      const saved = await saveScreenshotFromDataUrl(screenshotUrls[i]);
      if (!saved) continue;

      newScreenshots.push({
        id: randomUUID(),
        noteId: id,
        filePath: saved.filePath,
        mimeType: saved.mimeType,
        sortOrder: nextSortOrder + i,
        createdAt: now,
      });
    }

    if (newScreenshots.length > 0) {
      await db.insert(devNoteScreenshots).values(newScreenshots);
    }

    const items = await fetchDevNotes();
    const updated = items.find((item) => item.id === id);

    return NextResponse.json(updated ?? { id, kind, title, description });
  } catch (error) {
    console.error("[notes:patch]", error);
    return NextResponse.json(
      { error: "Could not update note." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await deleteDevNote(id);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[notes:delete]", error);
    return NextResponse.json(
      { error: "Could not delete note." },
      { status: 500 },
    );
  }
}
