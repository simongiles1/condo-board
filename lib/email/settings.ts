import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailSyncSettings } from "@/lib/db/schema";

export const DEFAULT_SYNC_CRON = "0 7 * * *";
export const DEFAULT_SETTINGS_ID = "default";

export type EmailSyncSettings = {
  syncCron: string;
  schedulerEnabled: boolean;
  harvestAfterSyncEnabled: boolean;
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
      backfillCutoffDate: null,
      updatedAt: now,
    };
    await db.insert(emailSyncSettings).values(defaults);
    return {
      syncCron: defaults.syncCron,
      schedulerEnabled: defaults.schedulerEnabled,
      harvestAfterSyncEnabled: defaults.harvestAfterSyncEnabled,
      updatedAt: defaults.updatedAt,
    };
  }

  return {
    syncCron: row.syncCron,
    schedulerEnabled: row.schedulerEnabled,
    harvestAfterSyncEnabled: row.harvestAfterSyncEnabled,
    updatedAt: row.updatedAt,
  };
}

export async function updateEmailSyncSettings(
  input: Partial<
    Pick<
      EmailSyncSettings,
      "syncCron" | "schedulerEnabled" | "harvestAfterSyncEnabled"
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
    updatedAt: new Date().toISOString(),
  };

  await db
    .update(emailSyncSettings)
    .set(updated)
    .where(eq(emailSyncSettings.id, DEFAULT_SETTINGS_ID));

  return updated;
}
