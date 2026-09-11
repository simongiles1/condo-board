export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getAllowlistEmails } from "@/lib/gmail/queries";
import { listCatchupWindowMessages } from "@/lib/gmail/sync-import-preview";

export async function POST(req: Request) {
  try {
    let body: { emails?: string[] } = {};
    try {
      body = (await req.json()) as { emails?: string[] };
    } catch {
      body = {};
    }

    const emails =
      Array.isArray(body.emails) && body.emails.length > 0
        ? body.emails
        : await getAllowlistEmails();

    const detail = await listCatchupWindowMessages(emails);

    if (!detail) {
      return NextResponse.json(
        { error: "Personal Gmail is not connected." },
        { status: 503 },
      );
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error("[email:sync:catchup-preview]", error);
    return NextResponse.json(
      { error: "Could not load catch-up message list." },
      { status: 500 },
    );
  }
}
