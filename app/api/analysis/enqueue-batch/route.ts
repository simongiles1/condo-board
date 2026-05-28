export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { enqueueEmailsAnalysisPending } from "@/lib/email-analysis/queue";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { emailIds?: string[] };

    if (!body.emailIds?.length) {
      return NextResponse.json(
        { error: "emailIds array is required." },
        { status: 400 },
      );
    }

    if (body.emailIds.length > 500) {
      return NextResponse.json(
        { error: "Maximum 500 emails per enqueue." },
        { status: 400 },
      );
    }

    await enqueueEmailsAnalysisPending(body.emailIds);

    return NextResponse.json({ queued: body.emailIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enqueue failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
