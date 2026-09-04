export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { loadMeetingTranscript } from "@/lib/meeting-v2/transcript";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const result = await loadMeetingTranscript(id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.payload);
  } catch (error) {
    console.error("[meetings:transcript]", error);
    return NextResponse.json(
      { error: "Could not load transcript." },
      { status: 500 },
    );
  }
}
