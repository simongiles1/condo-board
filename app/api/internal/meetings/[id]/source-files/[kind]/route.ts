export const runtime = "nodejs";

import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

import { isAuthorizedFilePullRequest } from "@/lib/dev/remote-source-pull";
import {
  resolveMeetingSourceFileTarget,
  type MeetingSourceFileKind,
} from "@/lib/meeting-v2/meeting-source-files";

const CONTENT_TYPES: Record<MeetingSourceFileKind, string> = {
  transcript: "text/vtt; charset=utf-8",
  "board-package": "application/pdf",
  "reference-pdf": "application/pdf",
};

function isMeetingSourceFileKind(value: string): value is MeetingSourceFileKind {
  return value === "transcript" || value === "board-package" || value === "reference-pdf";
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; kind: string }> },
) {
  if (!isAuthorizedFilePullRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, kind: kindParam } = await context.params;
  if (!isMeetingSourceFileKind(kindParam)) {
    return NextResponse.json({ error: "Unknown source file kind." }, { status: 400 });
  }

  try {
    const resolved = await resolveMeetingSourceFileTarget(id, kindParam);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const absolute = path.resolve(process.cwd(), resolved.target.relativePath);
    const buffer = await readFile(absolute);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[kindParam],
        "Content-Disposition": `inline; filename="${resolved.target.fileName.replace(/[^\w.\-() ]+/g, "_")}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[internal:source-files]", error);
    return NextResponse.json(
      { error: "Could not read the requested source file." },
      { status: 404 },
    );
  }
}
