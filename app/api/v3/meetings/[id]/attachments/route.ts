import { NextResponse } from "next/server";

import { AttachmentLinkError, linkMeetingV3Attachments } from "@/lib/meeting-v3/attachment-run";

export const maxDuration = 900;

/**
 * Links pages after the agenda split onto this meeting's V3 agenda.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await linkMeetingV3Attachments(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AttachmentLinkError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Attachment linking failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
