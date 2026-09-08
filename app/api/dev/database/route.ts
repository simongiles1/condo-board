export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { runPendingMigrations } from "@/lib/db/run-migrations";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const auth = await requireSession();
  if (isErrorResponse(auth)) return auth;

  const result = runPendingMigrations();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.output || "Migration failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, output: result.output });
}
