CREATE TABLE IF NOT EXISTS "project_board_report_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"status" text NOT NULL,
	"report_total" integer DEFAULT 0 NOT NULL,
	"report_completed" integer DEFAULT 0 NOT NULL,
	"skipped_unparsed" integer DEFAULT 0 NOT NULL,
	"matched_project_count" integer DEFAULT 0 NOT NULL,
	"unmatched_topic_count" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" text,
	"last_error" text,
	"started_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_board_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"filename" text NOT NULL,
	"email_id" text,
	"kind" text NOT NULL,
	"report_date" text,
	"received_at" text,
	"page_count" integer,
	"parse_status" text,
	"topics_json" text DEFAULT '[]' NOT NULL,
	"extraction_json" text,
	"error" text,
	"run_id" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_board_reports_content_hash_unique" ON "project_board_reports" ("content_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_board_reports_run_idx" ON "project_board_reports" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_board_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_key" text NOT NULL,
	"report_id" text NOT NULL,
	"topic_name" text NOT NULL,
	"confidence" text NOT NULL,
	"score" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_board_mentions" ADD CONSTRAINT "project_board_mentions_report_id_project_board_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."project_board_reports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_board_mentions_project_report_unique" ON "project_board_mentions" ("project_key","report_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_board_mentions_project_key_idx" ON "project_board_mentions" ("project_key");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_board_reports" ADD CONSTRAINT "project_board_reports_run_id_project_board_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."project_board_report_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_board_reports" ADD CONSTRAINT "project_board_reports_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
