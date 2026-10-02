import { NextResponse } from "next/server";

import { loadMeetingsV4Workspace, MeetingsV4Error } from "@/lib/meeting-v4/workspace";

/**
 * Returns the V4 segmentation preview, inventory, and any stored draft.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspace = await loadMeetingsV4Workspace(id);
    if (!workspace) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    return NextResponse.json(workspace);
  } catch (error) {
    if (error instanceof MeetingsV4Error) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "The V4 meeting could not be loaded.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
