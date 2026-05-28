export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { loadCalendarEventSource } from "@/lib/calendar/event-source";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const detail = await loadCalendarEventSource(id);

  if (!detail) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  return NextResponse.json(detail);
}
