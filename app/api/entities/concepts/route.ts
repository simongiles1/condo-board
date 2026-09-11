export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { loadConceptIndex } from "@/lib/entities/load-concept-index";

export async function GET() {
  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  try {
    const concepts = await loadConceptIndex();
    return NextResponse.json({ concepts });
  } catch (error) {
    console.error("[entities:concepts]", error);
    return NextResponse.json(
      { error: "Could not load concept index." },
      { status: 500 },
    );
  }
}
