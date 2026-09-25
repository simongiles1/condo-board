ALTER TABLE "email_sync_settings" ADD COLUMN IF NOT EXISTS "harvest_after_sync_kinds_json" text;
