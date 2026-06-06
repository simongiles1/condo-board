import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { emailSyncSettings } from "@/lib/db/schema";

export const DEFAULT_SYNC_CRON = "0 7 * * *";
export const DEFAULT_SETTINGS_ID = "default";

export type EmailSyncSettings = {
  syncCron: string;
  schedulerEnabled: boolean;
  /** ISO date (YYYY-MM-DD) or null when no backfill cutoff is set. */
  backfillCutoffDate: string | null;
  updatedAt: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidBackfillCutoffDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

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
      backfillCutoffDate: null,
      updatedAt: now,
    };
    await db.insert(emailSyncSettings).values(defaults);
    return {
      syncCron: defaults.syncCron,
      schedulerEnabled: defaults.schedulerEnabled,
      backfillCutoffDate: defaults.backfillCutoffDate,
      updatedAt: defaults.updatedAt,
    };
  }

  return {
    syncCron: row.syncCron,
    schedulerEnabled: row.schedulerEnabled,
    backfillCutoffDate: row.backfillCutoffDate ?? null,
    updatedAt: row.updatedAt,
  };
}

export async function updateEmailSyncSettings(
  input: Partial<
    Pick<EmailSyncSettings, "syncCron" | "schedulerEnabled" | "backfillCutoffDate">
  >,
): Promise<EmailSyncSettings> {
  const current = await getEmailSyncSettings();
  const db = getDb();
  const updated = {
    syncCron: input.syncCron ?? current.syncCron,
    schedulerEnabled: input.schedulerEnabled ?? current.schedulerEnabled,
    backfillCutoffDate:
      input.backfillCutoffDate !== undefined
        ? input.backfillCutoffDate
        : current.backfillCutoffDate,
    updatedAt: new Date().toISOString(),
  };

  await db
    .update(emailSyncSettings)
    .set(updated)
    .where(eq(emailSyncSettings.id, DEFAULT_SETTINGS_ID));

  return updated;
}
