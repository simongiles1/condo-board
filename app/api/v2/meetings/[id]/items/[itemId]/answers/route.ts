import { NextResponse } from "next/server";
import { filledClarificationAnswers, saveUserAnswers } from "@/lib/meeting-v2/service";

/** Persists user clarifications for an agenda item without starting re-investigation. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const { userAnswers } = await req.json();

    if (!userAnswers || typeof userAnswers !== "object" || Array.isArray(userAnswers)) {
      return NextResponse.json({ error: "userAnswers are required" }, { status: 400 });
    }

    const filled = filledClarificationAnswers(userAnswers);
    if (Object.keys(filled).length === 0) {
      return NextResponse.json({ error: "Type an answer before saving." }, { status: 400 });
    }

    await saveUserAnswers(id, itemId, filled);

    return NextResponse.json({ success: true, message: "Answers saved" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save answers";
    const status =
      message === "Type an answer before re-evaluating." || message === "Type an answer before saving."
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
