export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import {
  parseResolveHint,
  resolveEntityProfile,
} from "@/lib/entities/resolve-entity-profile";

export async function POST(request: Request) {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const hint = parseResolveHint(body);
  if (!hint) {
    return NextResponse.json(
      { error: "kind must be person, organization, project, equipment, or event." },
      { status: 400 },
    );
  }

  try {
    const result = await resolveEntityProfile(hint);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[entities:resolve]", error);
    return NextResponse.json(
      { error: "Could not resolve entity." },
      { status: 500 },
    );
  }
}
