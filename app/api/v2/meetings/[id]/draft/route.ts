import { NextResponse } from "next/server";
import {
  generateMeetingV2Draft,
  loadLatestMeetingV2Draft,
} from "@/lib/meeting-v2/service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const draft = await loadLatestMeetingV2Draft(id);
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: "Failed to fetch draft" }, { status: 500 });
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = await generateMeetingV2Draft(id);
    return NextResponse.json({ success: true, draft });
  } catch {
    return NextResponse.json({ error: "Failed to generate draft" }, { status: 500 });
  }
}
