export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  getAllowlistBackfillPreview,
  getAllowlistImportPreview,
} from "@/lib/gmail/allowlist-preview";
import { getAllowlistEmails } from "@/lib/gmail/queries";

export async function POST(req: Request) {
  try {
    let body: { emails?: string[]; remaining?: boolean } = {};
    try {
      body = (await req.json()) as { emails?: string[]; remaining?: boolean };
    } catch {
      body = {};
    }

    const emails =
      Array.isArray(body.emails) && body.emails.length > 0
        ? body.emails
        : await getAllowlistEmails();

    const preview = body.remaining
      ? await getAllowlistBackfillPreview(emails)
      : await getAllowlistImportPreview(emails);

    if (!preview) {
      return NextResponse.json(
        { error: "Personal Gmail is not connected." },
        { status: 503 },
      );
    }

    return NextResponse.json(preview);
  } catch (error) {
    console.error("[email:allowlist:preview]", error);
    return NextResponse.json(
      { error: "Could not estimate allowlist import size." },
      { status: 500 },
    );
  }
}
