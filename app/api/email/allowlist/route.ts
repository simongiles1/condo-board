export const runtime = "nodejs";

import { randomUUID } from "crypto";

import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { senderAllowlist } from "@/lib/db/schema";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(senderAllowlist)
      .orderBy(asc(senderAllowlist.email));
    return NextResponse.json(rows);
  } catch (error) {
    console.error("[email:allowlist:get]", error);
    return NextResponse.json(
      { error: "Could not load sender allowlist." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: {
    email?: string;
    displayName?: string;
    notes?: string;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "A valid email address is required." },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const row = {
      id: randomUUID(),
      email,
      displayName: body.displayName?.trim() || null,
      notes: body.notes?.trim() || null,
      addedAt: new Date().toISOString(),
    };

    await db.insert(senderAllowlist).values(row);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error("[email:allowlist:post]", error);
    return NextResponse.json(
      { error: "Could not add sender. It may already exist." },
      { status: 500 },
    );
  }
}
