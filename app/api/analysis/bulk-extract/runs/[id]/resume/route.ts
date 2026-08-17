export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { resumeBulkExtractRun } from "@/lib/email-analysis/bulk-extract-runs";
import { listBulkExtractTargets } from "@/lib/email-analysis/bulk-extract-targets";
import { kickBulkExtractWorker } from "@/lib/email-analysis/bulk-extract-worker";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { id } = await context.params;
  try {
    const { totalThreads, totalEmails } = await listBulkExtractTargets();
    const run = await resumeBulkExtractRun(id, { totalThreads, totalEmails });
    kickBulkExtractWorker(run.id);
    return NextResponse.json({ run });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not resume bulk extract run.";
    const status =
      message === "Run not found."
        ? 404
        : message.includes("Only failed") || message.includes("nothing to resume")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
