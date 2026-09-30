import { NextResponse } from "next/server";

import {
  AgendaExtractError,
  buildMeetingV3Agenda,
  listMeetingV3Agenda,
} from "@/lib/meeting-v3/agenda-run";

export const maxDuration = 900;

/**
 * Returns the agenda already stored for this V3 meeting.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const items = await listMeetingV3Agenda(id);
    return NextResponse.json({ meetingId: id, itemCount: items.length, items });
  } catch {
    return NextResponse.json({ error: "Failed to load the agenda." }, { status: 500 });
  }
}

/**
 * Builds the agenda from corrected pages and replaces the stored V3 agenda.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await buildMeetingV3Agenda(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AgendaExtractError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Agenda extraction failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
