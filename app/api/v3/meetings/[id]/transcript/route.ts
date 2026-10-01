import { NextResponse } from "next/server";

import { TranscriptSpanError, segmentMeetingV3Transcript } from "@/lib/meeting-v3/transcript-span-run";

export const maxDuration = 900;

/**
 * Assigns quoted transcript spans onto this meeting's V3 agenda.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await segmentMeetingV3Transcript(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TranscriptSpanError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Transcript segmentation failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
