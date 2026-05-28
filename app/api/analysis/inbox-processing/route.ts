export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { loadInboxAnalysisQueueState } from "@/lib/email/inbox-processing";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("emailIds")?.trim();

  if (!raw) {
    return NextResponse.json(
      { error: "emailIds query parameter is required." },
      { status: 400 },
    );
  }

  const emailIds = raw.split(",").map((id) => id.trim()).filter(Boolean);
  const state = await loadInboxAnalysisQueueState(emailIds);

  return NextResponse.json(state);
}
