import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailSyncSettings } from "@/lib/db/schema";

export const DEFAULT_SYNC_CRON = "0 7 * * *";
export const DEFAULT_SETTINGS_ID = "default";

export type EmailSyncSettings = {
  syncCron: string;
  schedulerEnabled: boolean;
  harvestAfterSyncEnabled: boolean;
  oauthRelinkRemindAfterDays: number;
  allowlistReviewTimeoutHours: number;
  pauseBetweenPipelineStages: boolean;
  lastOauthRelinkRemindedAt: string | null;
  updatedAt: string;
};

export async function getEmailSyncSettings(): Promise<EmailSyncSettings> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailSyncSettings)
    .where(eq(emailSyncSettings.id, DEFAULT_SETTINGS_ID));

  if (!row) {
    const now = new Date().toISOString();
    const defaults = {
      id: DEFAULT_SETTINGS_ID,
      syncCron: DEFAULT_SYNC_CRON,
      schedulerEnabled: true,
      harvestAfterSyncEnabled: false,
      oauthRelinkRemindAfterDays: 6,
      allowlistReviewTimeoutHours: 24,
      pauseBetweenPipelineStages: true,
      lastOauthRelinkRemindedAt: null as string | null,
      backfillCutoffDate: null,
      updatedAt: now,
    };
    await db.insert(emailSyncSettings).values(defaults);
    return {
      syncCron: defaults.syncCron,
      schedulerEnabled: defaults.schedulerEnabled,
      harvestAfterSyncEnabled: defaults.harvestAfterSyncEnabled,
      oauthRelinkRemindAfterDays: defaults.oauthRelinkRemindAfterDays,
      allowlistReviewTimeoutHours: defaults.allowlistReviewTimeoutHours,
      pauseBetweenPipelineStages: defaults.pauseBetweenPipelineStages,
      lastOauthRelinkRemindedAt: defaults.lastOauthRelinkRemindedAt,
      updatedAt: defaults.updatedAt,
    };
  }

  return {
    syncCron: row.syncCron,
    schedulerEnabled: row.schedulerEnabled,
    harvestAfterSyncEnabled: row.harvestAfterSyncEnabled,
    oauthRelinkRemindAfterDays: row.oauthRelinkRemindAfterDays ?? 6,
    allowlistReviewTimeoutHours: row.allowlistReviewTimeoutHours ?? 24,
    pauseBetweenPipelineStages: row.pauseBetweenPipelineStages ?? true,
    lastOauthRelinkRemindedAt: row.lastOauthRelinkRemindedAt ?? null,
    updatedAt: row.updatedAt,
  };
}

export async function updateEmailSyncSettings(
  input: Partial<
    Pick<
      EmailSyncSettings,
      | "syncCron"
      | "schedulerEnabled"
      | "harvestAfterSyncEnabled"
      | "oauthRelinkRemindAfterDays"
      | "allowlistReviewTimeoutHours"
      | "pauseBetweenPipelineStages"
      | "lastOauthRelinkRemindedAt"
    >
  >,
): Promise<EmailSyncSettings> {
  const current = await getEmailSyncSettings();
  const db = getDb();
  const updated = {
    syncCron: input.syncCron ?? current.syncCron,
    schedulerEnabled: input.schedulerEnabled ?? current.schedulerEnabled,
    harvestAfterSyncEnabled:
      input.harvestAfterSyncEnabled ?? current.harvestAfterSyncEnabled,
    oauthRelinkRemindAfterDays:
      input.oauthRelinkRemindAfterDays ?? current.oauthRelinkRemindAfterDays,
    allowlistReviewTimeoutHours:
      input.allowlistReviewTimeoutHours ?? current.allowlistReviewTimeoutHours,
    pauseBetweenPipelineStages:
      input.pauseBetweenPipelineStages ?? current.pauseBetweenPipelineStages,
    lastOauthRelinkRemindedAt:
      input.lastOauthRelinkRemindedAt === undefined
        ? current.lastOauthRelinkRemindedAt
        : input.lastOauthRelinkRemindedAt,
    updatedAt: new Date().toISOString(),
  };

  await db
    .update(emailSyncSettings)
    .set(updated)
    .where(eq(emailSyncSettings.id, DEFAULT_SETTINGS_ID));

  return updated;
}
