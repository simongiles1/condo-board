ALTER TABLE "bulk_extract_runs" ADD COLUMN IF NOT EXISTS "stint_started_at" text;
ALTER TABLE "bulk_extract_runs" ADD COLUMN IF NOT EXISTS "completed_emails_at_stint_start" integer DEFAULT 0 NOT NULL;
ALTER TABLE "bulk_extract_runs" ADD COLUMN IF NOT EXISTS "active_elapsed_ms" integer DEFAULT 0 NOT NULL;
