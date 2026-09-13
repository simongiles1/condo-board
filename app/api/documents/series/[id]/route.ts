export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { isErrorResponse, requireSession } from "@/lib/auth/authorize";
import { getSeriesById, listSeriesMembers } from "@/lib/documents/series";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (isErrorResponse(session)) return session;

  const { id } = await context.params;
  try {
    const series = await getSeriesById(id);
    if (!series) {
      return NextResponse.json({ error: "Series not found." }, { status: 404 });
    }
    const members = await listSeriesMembers(id);
    return NextResponse.json({
      id: series.id,
      title: series.title,
      description: series.description,
      usage: series.usage,
      members,
    });
  } catch (error) {
    console.error("[documents:series:get]", error);
    return NextResponse.json(
      { error: "Could not load files for this type." },
      { status: 500 },
    );
  }
}
