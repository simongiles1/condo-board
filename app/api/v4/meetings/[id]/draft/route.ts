import { NextResponse } from "next/server";

export const maxDuration = 800;

import { draftMeetingsV4 } from "@/lib/meeting-v4/draft-run";
import { MeetingsV4Error } from "@/lib/meeting-v4/workspace";

/**
 * Drafts minutes from the reviewed segmentation and stores the paragraphs and evidence notes.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspace = await draftMeetingsV4(id);
    return NextResponse.json(workspace);
  } catch (error) {
    if (error instanceof MeetingsV4Error) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "The V4 draft failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
