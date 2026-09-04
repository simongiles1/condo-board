import { NextResponse } from "next/server";

import { loadMeetingV2AiUsageStages } from "@/lib/meeting-v2/ai-usage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const stages = await loadMeetingV2AiUsageStages(id);
    return NextResponse.json({ stages });
  } catch (error) {
    console.error("[v2/ai-usage]", error);
    return NextResponse.json(
      { error: "Failed to load AI usage" },
      { status: 500 },
    );
  }
}
