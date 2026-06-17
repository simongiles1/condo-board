export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { startPersonalForwardWorkflow } from "@/lib/gmail/forward-workflow";

export async function POST(req: Request) {
  let body: { senderEmails?: string[] } = {};

  try {
    const text = await req.text();
    if (text) {
      body = JSON.parse(text) as typeof body;
    }
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const senderEmails = Array.isArray(body.senderEmails)
    ? body.senderEmails.filter((email) => typeof email === "string")
    : undefined;

  try {
    const status = await startPersonalForwardWorkflow({ senderEmails });
    return NextResponse.json(status);
  } catch (error) {
    console.error("[email:forward:start]", error);
    const message =
      error instanceof Error ? error.message : "Could not start forwarding.";
    const status = message.includes("already in progress") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
