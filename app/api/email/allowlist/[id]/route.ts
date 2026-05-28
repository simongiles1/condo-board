export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { senderAllowlist } from "@/lib/db/schema";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const db = getDb();
    await db.delete(senderAllowlist).where(eq(senderAllowlist.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[email:allowlist:delete:id]", error);
    return NextResponse.json(
      { error: "Could not remove sender." },
      { status: 500 },
    );
  }
}
