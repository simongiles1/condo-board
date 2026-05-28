export const runtime = "nodejs";

import { readFile } from "fs/promises";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { devNoteScreenshots } from "@/lib/db/schema";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();

  const [screenshot] = await db
    .select()
    .from(devNoteScreenshots)
    .where(eq(devNoteScreenshots.id, id));

  if (!screenshot) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const bytes = await readFile(screenshot.filePath);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": screenshot.mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
