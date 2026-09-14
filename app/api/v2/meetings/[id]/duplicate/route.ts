import { NextResponse } from "next/server";

import {
  duplicateMeetingV2ToAgendaApproval,
  MeetingV2DuplicateError,
} from "@/lib/meeting-v2/duplicate-meeting";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === "string" ? body.title : "";

  try {
    const duplicated = await duplicateMeetingV2ToAgendaApproval({
      sourceMeetingId: id,
      title,
    });
    return NextResponse.json(duplicated);
  } catch (error) {
    if (error instanceof MeetingV2DuplicateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[meetings/v2:duplicate]", error);
    return NextResponse.json(
      { error: "Could not duplicate meeting workspace." },
      { status: 500 },
    );
  }
}
