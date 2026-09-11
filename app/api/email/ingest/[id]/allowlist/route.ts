export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { decideAllowlistSender } from "@/lib/email/ingest-pipeline";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: { action?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const action = body.action;
  if (action !== "approved" && action !== "denied" && action !== "back") {
    return NextResponse.json(
      { error: "action must be approved, denied, or back." },
      { status: 400 },
    );
  }

  try {
    const run = await decideAllowlistSender({
      runId: id,
      action,
      via: "ui",
    });
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[email:ingest:allowlist]", error);
    const message =
      error instanceof Error ? error.message : "Could not apply allowlist decision.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
