-- Idempotent catch-up for databases that predate incremental migrations.
ALTER TABLE "extraction_sources" ADD COLUMN IF NOT EXISTS "triggered_by_user_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_forward_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"target_email" text NOT NULL,
	"source_query" text NOT NULL,
	"total_queued" integer DEFAULT 0 NOT NULL,
	"threads_matched" integer,
	"forwarded_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"chunk_size" integer DEFAULT 50 NOT NULL,
	"chunk_delay_ms" integer DEFAULT 120000 NOT NULL,
	"next_chunk_at" text,
	"started_at" text NOT NULL,
	"finished_at" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_forward_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processed_at" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_forwarded_messages" (
	"gmail_message_id" text PRIMARY KEY NOT NULL,
	"gmail_thread_id" text,
	"forward_run_id" text,
	"forward_message_id_header" text,
	"forwarded_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extraction_sources" ADD CONSTRAINT "extraction_sources_triggered_by_user_id_app_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_forward_queue" ADD CONSTRAINT "email_forward_queue_run_id_email_forward_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."email_forward_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "personal_forwarded_messages" ADD CONSTRAINT "personal_forwarded_messages_forward_run_id_email_forward_runs_id_fk" FOREIGN KEY ("forward_run_id") REFERENCES "public"."email_forward_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
