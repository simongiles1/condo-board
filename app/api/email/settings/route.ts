export const runtime = "nodejs";

import cron from "node-cron";
import { NextResponse } from "next/server";

import { refreshEmailScheduler } from "@/lib/email/scheduler";
import {
  getEmailSyncSettings,
  isValidBackfillCutoffDate,
  updateEmailSyncSettings,
} from "@/lib/email/settings";

export async function GET() {
  try {
    const settings = await getEmailSyncSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("[email:settings:get]", error);
    return NextResponse.json(
      { error: "Could not load email settings." },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  let body: {
    syncCron?: string;
    schedulerEnabled?: boolean;
    backfillCutoffDate?: string | null;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const syncCron =
    typeof body.syncCron === "string" ? body.syncCron.trim() : undefined;

  if (syncCron !== undefined && !cron.validate(syncCron)) {
    return NextResponse.json(
      { error: "Invalid automatic sync schedule." },
      { status: 400 },
    );
  }

  let backfillCutoffDate: string | null | undefined;
  if (body.backfillCutoffDate === null || body.backfillCutoffDate === "") {
    backfillCutoffDate = null;
  } else if (typeof body.backfillCutoffDate === "string") {
    const trimmed = body.backfillCutoffDate.trim();
    if (!isValidBackfillCutoffDate(trimmed)) {
      return NextResponse.json(
        { error: "Invalid backfill cutoff date. Use YYYY-MM-DD." },
        { status: 400 },
      );
    }
    backfillCutoffDate = trimmed;
  }

  try {
    const updated = await updateEmailSyncSettings({
      syncCron,
      schedulerEnabled:
        typeof body.schedulerEnabled === "boolean"
          ? body.schedulerEnabled
          : undefined,
      backfillCutoffDate,
    });

    await refreshEmailScheduler();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[email:settings:patch]", error);
    return NextResponse.json(
      { error: "Could not update email settings." },
      { status: 500 },
    );
  }
}
