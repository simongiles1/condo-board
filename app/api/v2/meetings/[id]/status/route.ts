import { NextResponse } from "next/server";
import { loadMeetingV2Detail } from "@/lib/meeting-v2/service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const detail = await loadMeetingV2Detail(id);
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 });
  }
}
