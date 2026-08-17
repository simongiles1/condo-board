export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { getIbmDoclingSpendSummary } from "@/lib/email/ibm-docling-spend";

export async function GET() {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const summary = await getIbmDoclingSpendSummary();
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load IBM Docling spend.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
