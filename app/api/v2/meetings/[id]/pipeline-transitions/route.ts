import { NextResponse } from "next/server";

import { loadMeetingV2PipelineTransitions } from "@/lib/meeting-v2/pipeline-transitions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = await loadMeetingV2PipelineTransitions(id);
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[v2/pipeline-transitions]", error);
    return NextResponse.json(
      { error: "Failed to load pipeline transitions" },
      { status: 500 },
    );
  }
}
