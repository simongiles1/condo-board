export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { continueIngestRun } from "@/lib/email/ingest-pipeline";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const run = await continueIngestRun(id);
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[email:ingest:continue]", error);
    const message =
      error instanceof Error ? error.message : "Could not continue ingest.";
    const status = message.includes("not waiting") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
