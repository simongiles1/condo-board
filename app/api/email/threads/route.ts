export const runtime = "nodejs";

import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { emailThreads } from "@/lib/db/schema";

export async function GET() {
  try {
    const db = getDb();
    const threads = await db
      .select()
      .from(emailThreads)
      .orderBy(desc(emailThreads.lastMessageAt));

    return NextResponse.json(threads);
  } catch (error) {
    console.error("[email:threads:get]", error);
    return NextResponse.json(
      { error: "Could not load email threads." },
      { status: 500 },
    );
  }
}
