export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { bridgeAllFinalizedMeetings } from "@/lib/email-analysis/meeting-bridge";

export async function POST() {
  try {
    const count = await bridgeAllFinalizedMeetings();
    return NextResponse.json({ bridgedCount: count });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Meeting bridge failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
