export const runtime = "nodejs";

import cron from "node-cron";
import { NextResponse } from "next/server";

import { getBackfillCutoff } from "@/lib/email/backfill-cutoff";
import { refreshEmailScheduler } from "@/lib/email/scheduler";
import {
  getEmailSyncSettings,
  updateEmailSyncSettings,
} from "@/lib/email/settings";

export async function GET() {
  try {
    const [settings, backfillCutoff] = await Promise.all([
      getEmailSyncSettings(),
      getBackfillCutoff(),
    ]);
    return NextResponse.json({
      ...settings,
      backfillCutoffAt: backfillCutoff.cutoffAt,
      oldestDedicatedReceivedAt: backfillCutoff.oldestDedicatedReceivedAt,
    });
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
    harvestAfterSyncEnabled?: boolean;
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

  try {
    const updated = await updateEmailSyncSettings({
      syncCron,
      schedulerEnabled:
        typeof body.schedulerEnabled === "boolean"
          ? body.schedulerEnabled
          : undefined,
      harvestAfterSyncEnabled:
        typeof body.harvestAfterSyncEnabled === "boolean"
          ? body.harvestAfterSyncEnabled
          : undefined,
    });

    await refreshEmailScheduler();

    const backfillCutoff = await getBackfillCutoff();
    return NextResponse.json({
      ...updated,
      backfillCutoffAt: backfillCutoff.cutoffAt,
      oldestDedicatedReceivedAt: backfillCutoff.oldestDedicatedReceivedAt,
    });
  } catch (error) {
    console.error("[email:settings:patch]", error);
    return NextResponse.json(
      { error: "Could not update email settings." },
      { status: 500 },
    );
  }
}
