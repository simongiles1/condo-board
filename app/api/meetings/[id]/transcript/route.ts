export const runtime = "nodejs";

import { readFile } from "fs/promises";
import path from "path";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { meetings } from "@/lib/db/schema";
import {
  vttToMergedCues,
  vttToReadableTranscript,
} from "@/lib/parsers/vtt";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const db = getDb();

    const [meeting] = await db
      .select({ vttFilePath: meetings.vttFilePath })
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    const absolute = path.resolve(process.cwd(), meeting.vttFilePath);
    const uploadRoot = path.resolve(process.cwd(), "uploads", id);

    if (!absolute.startsWith(uploadRoot)) {
      return NextResponse.json(
        { error: "Invalid transcript path." },
        { status: 400 },
      );
    }

    const content = await readFile(absolute, "utf8");
    const fileName = path.basename(meeting.vttFilePath);
    const cues = vttToMergedCues(content);
    const readable = vttToReadableTranscript(content);

    return NextResponse.json({ content, readable, cues, fileName });
  } catch (error) {
    console.error("[meetings:transcript]", error);
    return NextResponse.json(
      { error: "Could not read transcript file." },
      { status: 500 },
    );
  }
}
