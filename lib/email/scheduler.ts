import cron, { type ScheduledTask } from "node-cron";

import { syncPersonalAccount } from "@/lib/gmail/sync";

import { getEmailSyncSettings } from "./settings";

let scheduledTask: ScheduledTask | null = null;
let currentExpression: string | null = null;

export async function runScheduledSync() {
  console.info("[email-scheduler] Running personal Gmail sync");
  const result = await syncPersonalAccount("cron");
  console.info(
    `[email-scheduler] Added ${result.messagesAdded}, skipped ${result.messagesSkipped}`,
  );
  if (result.errors.length > 0) {
    console.error("[email-scheduler] Errors:", result.errors.join("; "));
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

  scheduledTask = cron.schedule(settings.syncCron, () => {
    void runScheduledSync();
  });
  currentExpression = settings.syncCron;
  console.info(
    `[email-scheduler] Scheduled with cron "${settings.syncCron}"`,
  );
}

export function getSchedulerStatus() {
  return {
    running: scheduledTask !== null,
    expression: currentExpression,
  };
}

export function startEmailScheduler() {
  void refreshEmailScheduler();
}
