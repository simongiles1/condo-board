import { NextResponse } from "next/server";

import {
  MeetingReconciliationError,
  reconcileMeetingV3Conclusions,
} from "@/lib/meeting-v3/meeting-conclusions-run";

export const maxDuration = 120;

/**
 * Stores what each topic's transcript stretch supports, separate from the package facts.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await reconcileMeetingV3Conclusions(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MeetingReconciliationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Meeting reconciliation failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
