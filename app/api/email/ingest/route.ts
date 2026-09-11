export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  getActiveIngestRun,
  startIngestPipeline,
} from "@/lib/email/ingest-pipeline";
import { maybeSendOauthRelinkReminder } from "@/lib/email/ingest-pipeline";

export async function GET() {
  try {
    await maybeSendOauthRelinkReminder().catch(() => undefined);
    const run = await getActiveIngestRun({ resumeIfIdle: true });
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[email:ingest:get]", error);
    return NextResponse.json(
      { error: "Could not load ingest pipeline." },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const run = await startIngestPipeline("manual");
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[email:ingest:post]", error);
    const message =
      error instanceof Error ? error.message : "Ingest pipeline failed.";
    const status = message.includes("already") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
