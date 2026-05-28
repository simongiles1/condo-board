export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getCostSummary } from "@/lib/email-analysis/cost-summary";

export async function GET() {
  const summary = await getCostSummary();
  return NextResponse.json(summary);
}
