import { NextResponse } from "next/server";

import { loadMeetingsV3AiUsageStages } from "@/lib/meeting-v3/ai-usage";

/**
 * Returns per-stage AI token and cost totals for a V3 meeting.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const stages = await loadMeetingsV3AiUsageStages(id);
    return NextResponse.json(
      { stages },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("[v3/ai-usage]", error);
    return NextResponse.json(
      { error: "Failed to load AI usage" },
      { status: 500 },
    );
  }
}
