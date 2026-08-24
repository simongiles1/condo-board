import { NextResponse } from "next/server";
import { generateMeetingV2Draft } from "@/lib/meeting-v2/service";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = await generateMeetingV2Draft(id);
    return NextResponse.json({ success: true, draft });
  } catch (err) {
    return NextResponse.json({ error: "Failed to generate draft" }, { status: 500 });
  }
}
