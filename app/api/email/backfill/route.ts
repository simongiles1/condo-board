export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { backfillPersonalAccount } from "@/lib/gmail/backfill";

export async function POST(req: Request) {
  let body: { senderEmail?: string } = {};

  try {
    const text = await req.text();
    if (text) {
      body = JSON.parse(text) as typeof body;
    }
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  try {
    const result = await backfillPersonalAccount({
      senderEmail:
        typeof body.senderEmail === "string"
          ? body.senderEmail.trim()
          : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[email:backfill]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Personal backfill failed.",
      },
      { status: 500 },
    );
  }
}
