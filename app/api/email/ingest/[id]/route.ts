export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getIngestRun } from "@/lib/email/ingest-pipeline";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const run = await getIngestRun(id, { resumeIfIdle: true });
    if (!run) {
      return NextResponse.json({ error: "Ingest run not found." }, { status: 404 });
    }
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[email:ingest:id:get]", error);
    return NextResponse.json(
      { error: "Could not load ingest run." },
      { status: 500 },
    );
  }
}
