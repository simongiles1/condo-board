import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { ensureMeetingV2Seed } from "@/lib/meeting-v2/service";

export async function POST(req: Request) {
  try {
    const { meetingId } = await req.json();

    if (!meetingId) {
      return NextResponse.json({ error: "meetingId is required" }, { status: 400 });
    }

    await ensureMeetingV2Seed(meetingId);
    await inngest.send({
      name: "meeting-v2/pipeline.start",
      data: { meetingId },
    });

    return NextResponse.json({ success: true, message: "Pipeline started" });
  } catch (err) {
    return NextResponse.json({ error: "Failed to start pipeline" }, { status: 500 });
  }
}
