import { NextResponse } from "next/server";

import {
  buildMeetingPageRewrites,
  listMeetingPageRewrites,
  PageRewriteError,
} from "@/lib/meeting-v3/page-rewrite-run";

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
 * Rewrites each extracted page as Docling-style markdown and replaces the stored rewrites.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await buildMeetingPageRewrites(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PageRewriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Page rewrite failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
