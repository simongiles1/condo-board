export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getSyncRunHistory } from "@/lib/email/sync-run-history";

export async function GET() {
  try {
    const runs = await getSyncRunHistory();
    return NextResponse.json({ runs });
  } catch (error) {
    console.error("[email:sync:history]", error);
    return NextResponse.json(
      { error: "Could not load sync history." },
      { status: 500 },
    );
  }
}
