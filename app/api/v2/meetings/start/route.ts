import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { ensureMeetingV2Seed } from "@/lib/meeting-v2/service";
import { getDb } from "@/lib/db";
import { meetingsV2 } from "@/lib/db/schema-v2";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const { meetingId, autonomyTemperature } = await req.json();

    if (!meetingId) {
      return NextResponse.json({ error: "meetingId is required" }, { status: 400 });
    }

    
    if (autonomyTemperature !== undefined) {
      const db = getDb();
      const existing = await db.query.meetingsV2.findFirst({ where: eq(meetingsV2.id, meetingId) });
      const currentSettings = existing?.settings || {};
      await db.update(meetingsV2)
        .set({ settings: { ...currentSettings, autonomyTemperature: Number(autonomyTemperature) } })
        .where(eq(meetingsV2.id, meetingId));
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
