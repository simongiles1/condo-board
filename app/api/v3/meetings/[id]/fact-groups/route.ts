import { NextResponse } from "next/server";

import { FactGroupingError, groupMeetingV3Facts } from "@/lib/meeting-v3/fact-group-run";

export const maxDuration = 900;

/**
 * Groups quoted facts on this meeting's V3 agenda by the package quote that contains them.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await groupMeetingV3Facts(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FactGroupingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Fact grouping failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
