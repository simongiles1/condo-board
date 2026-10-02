import { NextResponse } from "next/server";

export const maxDuration = 800;

import {
  draftMeetingV3Minutes,
  loadMeetingV3MinutesDraft,
  MeetingsV3MinutesError,
} from "@/lib/meeting-v3/minutes-draft-run";

/**
 * Returns the stored V3 minutes draft.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const draft = await loadMeetingV3MinutesDraft(id);
    if (!draft) return NextResponse.json({ error: "No minutes draft is stored." }, { status: 404 });
    return NextResponse.json(draft);
  } catch (error) {
    if (error instanceof MeetingsV3MinutesError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Minutes draft could not be loaded.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

/**
 * Stores a new deterministic minutes draft from the current check.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await draftMeetingV3Minutes(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MeetingsV3MinutesError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Minutes draft failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
