export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { syncPersonalAccount } from "@/lib/gmail/sync";

export async function POST() {
  try {
    const result = await syncPersonalAccount("manual");
    return NextResponse.json(result);
  } catch (error) {
    console.error("[email:sync]", error);
    const message =
      error instanceof Error ? error.message : "Personal Gmail sync failed.";
    const status = message.includes("already running")
      ? 409
      : message.includes("OAuth token")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
