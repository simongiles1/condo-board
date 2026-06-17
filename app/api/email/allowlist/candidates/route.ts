export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { listAllowlistCandidates } from "@/lib/email/allowlist-candidates";

export async function GET() {
  try {
    const candidates = await listAllowlistCandidates();
    return NextResponse.json(candidates);
  } catch (error) {
    console.error("[email:allowlist:candidates]", error);
    return NextResponse.json(
      { error: "Could not load sender addresses." },
      { status: 500 },
    );
  }
}
