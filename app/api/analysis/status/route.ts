export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getAnalysisStatus } from "@/lib/email-analysis/cost-summary";

export async function GET() {
  const status = await getAnalysisStatus();
  return NextResponse.json(status);
}
