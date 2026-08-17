export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { resolvePersonAtTime } from "@/lib/contacts/registry-resolve";

/** Report helper: GET /api/contacts/resolve?email=…&at=ISO */
export async function GET(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim() ?? "";
  const at = url.searchParams.get("at")?.trim() ?? null;

  if (!email) {
    return NextResponse.json(
      { error: "email query parameter is required." },
      { status: 400 },
    );
  }

  const result = await resolvePersonAtTime(email, at);
  return NextResponse.json(result);
}
