import { NextResponse } from "next/server";

import { MeetingsV3PackageError, runMeetingsV3PackageExtraction } from "@/lib/meeting-v3/package-extract";
import { loadMeetingsV3PackageStatus } from "@/lib/meeting-v3/package-status";
import { PageRewriteError } from "@/lib/meeting-v3/page-rewrite-run";

export const maxDuration = 900;

/**
 * Returns package-extraction progress for a V3 meeting.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const status = await loadMeetingsV3PackageStatus(id);
    if (!status) {
      return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    }
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: "Failed to load package status." }, { status: 500 });
  }
}

/**
 * Extracts the board package, then corrects every stored page.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const status = await runMeetingsV3PackageExtraction(id);
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof MeetingsV3PackageError || error instanceof PageRewriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Package extraction failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
