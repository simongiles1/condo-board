export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { capturePlaybackUrl, LiveRoomError } from "@/lib/meeting-v2/live-room";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; trackId: string }> },
) {
  const { id, trackId } = await context.params;
  try {
    const url = await capturePlaybackUrl(id, trackId);
    return NextResponse.redirect(url);
  } catch (error) {
    if (error instanceof LiveRoomError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[meetings/v2/live/capture]", error);
    return NextResponse.json({ error: "Could not open the recording." }, { status: 500 });
  }
}
