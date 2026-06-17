export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { clearAllEmails } from "@/lib/email/clear-all-emails";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { confirm?: boolean };

    if (!body.confirm) {
      return NextResponse.json(
        { error: "Confirmation required." },
        { status: 400 },
      );
    }

    const result = await clearAllEmails();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[email:clear-all]", error);
    return NextResponse.json(
      { error: "Could not delete imported emails." },
      { status: 500 },
    );
  }
}
