export const runtime = "nodejs";

import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  const db = getDb();
  const events = await db
    .select()
    .from(calendarEvents)
    .orderBy(asc(calendarEvents.startAt));

  const filtered = events.filter((event) => {
    if (start && event.startAt < start) return false;
    if (end && event.startAt > end) return false;
    return true;
  });

  return NextResponse.json({ events: filtered });
}
