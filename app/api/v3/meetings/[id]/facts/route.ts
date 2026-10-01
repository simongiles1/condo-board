import { NextResponse } from "next/server";

import { FactResolutionError, resolveMeetingV3Facts } from "@/lib/meeting-v3/fact-run";

export const maxDuration = 900;

/**
 * Resolves quoted package facts onto this meeting's V3 agenda.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await resolveMeetingV3Facts(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FactResolutionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : "Fact resolution failed.";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
