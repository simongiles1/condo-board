import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { saveUserAnswers } from "@/lib/meeting-v2/service";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params;
    const { userAnswers } = await req.json();

    if (!userAnswers) {
      return NextResponse.json({ error: "userAnswers are required" }, { status: 400 });
    }

    await saveUserAnswers(id, itemId, userAnswers);

    await inngest.send({
      name: "meeting-v2/item.reevaluate",
      data: { meetingId: id, itemId, userAnswers },
    });

    return NextResponse.json({ success: true, message: "Re-evaluation started" });
  } catch (err) {
    return NextResponse.json({ error: "Failed to trigger re-evaluation" }, { status: 500 });
  }
}
