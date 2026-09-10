export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { searchEmailsForTargeting } from "@/lib/rag/file-card-runs";

export async function GET(request: Request) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const limitRaw = Number(searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

    const results = await searchEmailsForTargeting(query, limit);
    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not search emails for targeting.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
