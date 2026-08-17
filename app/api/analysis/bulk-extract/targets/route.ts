export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { listBulkExtractTargets } from "@/lib/email-analysis/bulk-extract-targets";

export async function GET() {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  try {
    const result = await listBulkExtractTargets();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not list bulk extract targets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
