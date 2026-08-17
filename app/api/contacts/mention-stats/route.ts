export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { loadMentionChartData } from "@/lib/contacts/mention-chart";

/** GET /api/contacts/mention-stats — registry mention frequency for the chart modal. */
export async function GET() {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  try {
    const data = await loadMentionChartData(2000);
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Mention stats failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
