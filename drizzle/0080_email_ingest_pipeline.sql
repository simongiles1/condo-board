ALTER TABLE "email_sync_settings" ADD COLUMN IF NOT EXISTS "oauth_relink_remind_after_days" integer DEFAULT 6 NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_sync_settings" ADD COLUMN IF NOT EXISTS "allowlist_review_timeout_hours" integer DEFAULT 24 NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_sync_settings" ADD COLUMN IF NOT EXISTS "pause_between_pipeline_stages" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_sync_settings" ADD COLUMN IF NOT EXISTS "last_oauth_relink_reminded_at" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sender_blocklist" (
	"email" text PRIMARY KEY NOT NULL,
	"blocked_at" text NOT NULL,
	"ingest_run_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_ingest_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"wait_kind" text,
	"last_successful_sync_at" text,
	"new_email_ids_json" text DEFAULT '[]' NOT NULL,
	"counts_json" text DEFAULT '{}' NOT NULL,
	"cursor_index" integer DEFAULT 0 NOT NULL,
	"reminder_sent_at" text,
	"telegram_chat_id" text,
	"telegram_message_id" integer,
	"telegram_review_item_id" text,
	"last_error" text,
	"started_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_ingest_sender_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"sort_index" integer NOT NULL,
	"estimated_thread_count" integer,
	"estimated_email_count" integer,
	"decided_at" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_ingest_sender_reviews_run_email_idx" ON "email_ingest_sender_reviews" ("run_id","email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_ingest_sender_reviews_run_sort_idx" ON "email_ingest_sender_reviews" ("run_id","sort_index");
--> statement-breakpoint
ALTER TABLE "email_ingest_sender_reviews" ADD CONSTRAINT "email_ingest_sender_reviews_run_id_email_ingest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "email_ingest_runs"("id") ON DELETE cascade ON UPDATE no action;
