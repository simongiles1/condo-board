import cron, { type ScheduledTask } from "node-cron";

import { runIngestThenHarvest } from "@/lib/email/ingest-harvest";
import {
  maybeSendOauthRelinkReminder,
  remindStaleAllowlistReviews,
} from "@/lib/email/ingest-pipeline";

import { DISPLAY_TIME_ZONE } from "@/lib/format/datetime";

import { getEmailSyncSettings } from "./settings";

/** Clock times saved in Email Settings are Eastern (Toronto), including DST. */
export const EMAIL_SYNC_CRON_TIME_ZONE = DISPLAY_TIME_ZONE;

let scheduledTask: ScheduledTask | null = null;
let currentExpression: string | null = null;

export async function runScheduledSync() {
  console.info("[email-scheduler] Running personal Gmail sync");
  await maybeSendOauthRelinkReminder().catch((error) => {
    console.error("[email-scheduler] OAuth relink reminder failed", error);
  });
  await remindStaleAllowlistReviews().catch((error) => {
    console.error("[email-scheduler] Allowlist reminder failed", error);
  });
  const result = await runIngestThenHarvest("cron");
  console.info(
    `[email-scheduler] Added ${result.messagesAdded}, skipped ${result.messagesSkipped}`,
  );
  if (result.errors.length > 0) {
    console.error("[email-scheduler] Errors:", result.errors.join("; "));
  }
  if (result.harvest.status !== "disabled") {
    console.info("[email-scheduler] Harvest after sync", result.harvest);
  }
  return result;
}

export async function refreshEmailScheduler() {
  const settings = await getEmailSyncSettings();

  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    currentExpression = null;
  }

  if (!settings.schedulerEnabled) {
    console.info("[email-scheduler] Scheduler disabled");
    return;
  }

  if (!cron.validate(settings.syncCron)) {
    console.error(
      `[email-scheduler] Invalid cron expression: ${settings.syncCron}`,
    );
    return;
  }

  scheduledTask = cron.schedule(
    settings.syncCron,
    () => {
      void runScheduledSync();
    },
    { timezone: EMAIL_SYNC_CRON_TIME_ZONE },
  );
  currentExpression = settings.syncCron;
  console.info(
    `[email-scheduler] Scheduled with cron "${settings.syncCron}" (${EMAIL_SYNC_CRON_TIME_ZONE})`,
  );
}

export function getSchedulerStatus() {
  return {
    running: scheduledTask !== null,
    expression: currentExpression,
  };
}

export function startEmailScheduler() {
  void refreshEmailScheduler().catch((error) => {
    console.error("[email-scheduler] Failed to start:", error);
  });
  void maybeSendOauthRelinkReminder().catch((error) => {
    console.error("[email-scheduler] OAuth relink reminder failed", error);
  });
}
