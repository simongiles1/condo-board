export const runtime = "nodejs";

import { NextResponse } from "next/server";

import {
  getEmailSyncSettings,
  isValidBackfillCutoffDate,
} from "@/lib/email/settings";
import { backfillPersonalAccount } from "@/lib/gmail/backfill";

export async function POST(req: Request) {
  let body: { senderEmail?: string; cutoffDate?: string | null } = {};

  try {
    const text = await req.text();
    if (text) {
      body = JSON.parse(text) as typeof body;
    }
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  let cutoffDate: string | undefined;
  if (body.cutoffDate === null || body.cutoffDate === "") {
    cutoffDate = undefined;
  } else if (typeof body.cutoffDate === "string") {
    const trimmed = body.cutoffDate.trim();
    if (!isValidBackfillCutoffDate(trimmed)) {
      return NextResponse.json(
        { error: "Invalid backfill cutoff date. Use YYYY-MM-DD." },
        { status: 400 },
      );
    }
    cutoffDate = trimmed;
  } else {
    const settings = await getEmailSyncSettings();
    cutoffDate = settings.backfillCutoffDate ?? undefined;
  }

  try {
    const result = await backfillPersonalAccount({
      senderEmail:
        typeof body.senderEmail === "string"
          ? body.senderEmail.trim()
          : undefined,
      cutoffDate,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[email:backfill]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Personal backfill failed.",
      },
      { status: 500 },
    );
  }
}
