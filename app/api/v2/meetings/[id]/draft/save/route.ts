import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { meetingsV2MinutesDrafts } from "@/lib/db/schema-v2";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { draftId, summaryJson, contentMarkdown } = body;

    if (!draftId || !summaryJson || !contentMarkdown) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = getDb();
    
    // We update the specific draft row with the edited json and markdown
    await db.update(meetingsV2MinutesDrafts)
      .set({
        summaryJson,
        contentMarkdown,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(meetingsV2MinutesDrafts.id, draftId));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to save draft:", err);
    return NextResponse.json({ error: "Failed to save draft" }, { status: 500 });
  }
}
