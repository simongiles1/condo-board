export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { reconcileThreadActionItems } from "@/lib/email-analysis/action-item-reconciliation";
import { getAnalysisSettings } from "@/lib/email-analysis/settings";
import { getDb } from "@/lib/db";
import { emails } from "@/lib/db/schema";

type Payload = {
  threadId?: string;
  emailId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Payload;
    const db = getDb();
    const settings = await getAnalysisSettings();

    let threadId = body.threadId?.trim() || null;
    if (!threadId && body.emailId?.trim()) {
      const [email] = await db
        .select({ threadId: emails.threadId })
        .from(emails)
        .where(eq(emails.id, body.emailId.trim()));
      threadId = email?.threadId ?? null;
    }

    if (!threadId) {
      return NextResponse.json(
        { error: "threadId or emailId with a thread is required." },
        { status: 400 },
      );
    }

    const result = await reconcileThreadActionItems({
      threadId,
      analyzedEmailId: body.emailId?.trim() || undefined,
      modelName: settings.analysisModel,
    });

    return NextResponse.json({
      threadId,
      completed: result.completed,
      superseded: result.superseded,
      costUsd: result.costUsd,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Action item reconciliation failed.",
      },
      { status: 500 },
    );
  }
}
