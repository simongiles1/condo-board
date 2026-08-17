export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getCostSummary } from "@/lib/email-analysis/cost-summary";

export async function GET() {
  try {
    const summary = await getCostSummary();
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load cost summary.";
    console.error("[analysis:cost-summary]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
