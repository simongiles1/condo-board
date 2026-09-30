import { NextResponse } from "next/server";

import {
  MeetingsV3PackageError,
  runMeetingsV3AgendaCorrectionOnly,
} from "@/lib/meeting-v3/package-extract";
import { listMeetingPageRewrites, PageRewriteError } from "@/lib/meeting-v3/page-rewrite-run";

export const maxDuration = 900;

/**
 * Returns the Docling-style page rewrites already stored for this meeting.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const pages = await listMeetingPageRewrites(id);
    return NextResponse.json({ meetingId: id, pageCount: pages.length, pages });
  } catch {
    return NextResponse.json({ error: "Failed to load the corrected pages." }, { status: 500 });
  }
}

/**
 * Corrects agenda pages from the stored extract without re-running Docling.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const status = await runMeetingsV3AgendaCorrectionOnly(id);
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof MeetingsV3PackageError || error instanceof PageRewriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Page correction failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
