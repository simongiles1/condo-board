import { NextResponse } from "next/server";

import {
  MeetingsV3MinutesError,
  validateMeetingV3Minutes,
} from "@/lib/meeting-v3/minutes-draft-run";

/**
 * Checks reconciled topics and stores the open points a draft must keep visible.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await validateMeetingV3Minutes(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MeetingsV3MinutesError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Minutes check failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
