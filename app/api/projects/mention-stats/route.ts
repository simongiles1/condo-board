export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { loadProjectMentionChartData } from "@/lib/projects/mention-chart";

/** GET /api/projects/mention-stats — project mention frequency for the chart modal. */
export async function GET() {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  try {
    const data = await loadProjectMentionChartData();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Mention stats failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
