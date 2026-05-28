export const runtime = "nodejs";

import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { devNoteScreenshots, devNotes } from "@/lib/db/schema";
import { fetchDevNotes } from "@/lib/notes/fetch-notes";
import { saveScreenshotFromDataUrl } from "@/lib/notes/screenshots";
import { parseDevNoteStatus } from "@/lib/notes/status";

export async function GET() {
  const items = await fetchDevNotes();
  return NextResponse.json({ items });
}

type PostBody = {
  kind?: string;
  status?: string;
  title?: string;
  description?: string;
  screenshots?: string[];
};

export async function POST(request: Request) {
  try {
    let body: PostBody;

    try {
      body = (await request.json()) as PostBody;
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON payload" },
        { status: 400 },
      );
    }

    const kind =
      body.kind === "feature" ? "feature" : body.kind === "bug" ? "bug" : null;
    const status = parseDevNoteStatus(body.status) ?? "open";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const screenshotUrls = Array.isArray(body.screenshots)
      ? body.screenshots.filter((s): s is string => typeof s === "string")
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

    const now = new Date().toISOString();
    const noteId = randomUUID();
    const db = getDb();

    const savedScreenshots: Array<{
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

      savedScreenshots.push({
        id: randomUUID(),
        noteId,
        filePath: saved.filePath,
        mimeType: saved.mimeType,
        sortOrder: i,
        createdAt: now,
      });
    }

    await db.insert(devNotes).values({
      id: noteId,
      kind,
      status,
      title,
      description,
      createdAt: now,
    });

    if (savedScreenshots.length > 0) {
      await db.insert(devNoteScreenshots).values(savedScreenshots);
    }

    const items = await fetchDevNotes();
    const created = items.find((item) => item.id === noteId);

    if (!created) {
      return NextResponse.json(
        { error: "Note was saved but could not be loaded." },
        { status: 500 },
      );
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("[notes:post]", error);
    return NextResponse.json(
      { error: "Could not save note." },
      { status: 500 },
    );
  }
}
