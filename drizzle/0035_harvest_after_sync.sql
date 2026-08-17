ALTER TABLE "email_sync_settings" ADD COLUMN IF NOT EXISTS "harvest_after_sync_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "bulk_extract_runs" ADD COLUMN IF NOT EXISTS "target_scope" text DEFAULT 'all' NOT NULL;
