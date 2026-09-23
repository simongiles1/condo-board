import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { filledClarificationAnswers, saveUserAnswers } from "@/lib/meeting-v2/service";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params;
    const body = await req.json();
    const { userAnswers, retryProcessing } = body as { userAnswers?: unknown; retryProcessing?: unknown };

    if (userAnswers != null && (typeof userAnswers !== "object" || Array.isArray(userAnswers))) {
      return NextResponse.json({ error: "userAnswers are required" }, { status: 400 });
    }

    const filled = filledClarificationAnswers(
      userAnswers && typeof userAnswers === "object" && !Array.isArray(userAnswers)
        ? (userAnswers as Record<string, string>)
        : {},
    );
    if (retryProcessing !== true && Object.keys(filled).length === 0) {
      return NextResponse.json({ error: "Type an answer before re-evaluating." }, { status: 400 });
    }

    if (Object.keys(filled).length > 0) {
      await saveUserAnswers(id, itemId, filled);
    }

    await inngest.send({
      name: "meeting-v2/item.reevaluate",
      data: { meetingId: id, itemId, userAnswers: filled },
    });

    return NextResponse.json({ success: true, message: "Re-evaluation started" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to trigger re-evaluation";
    const status = message === "Type an answer before re-evaluating." ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
