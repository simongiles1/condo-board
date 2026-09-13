CREATE TABLE IF NOT EXISTS "document_series_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total_docs" integer DEFAULT 0 NOT NULL,
	"clustered_docs" integer DEFAULT 0 NOT NULL,
	"series_count" integer DEFAULT 0 NOT NULL,
	"embed_tokens" integer DEFAULT 0 NOT NULL,
	"llm_input_tokens" integer DEFAULT 0 NOT NULL,
	"llm_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" text DEFAULT '0' NOT NULL,
	"current_label" text,
	"error_message" text,
	"started_at" text NOT NULL,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_series" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"usage" text,
	"run_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_series_members" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"series_id" text NOT NULL,
	"source" text DEFAULT 'discovery' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_series_exclusions" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_series"
  ADD CONSTRAINT "document_series_run_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."document_series_runs"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_series_members"
  ADD CONSTRAINT "document_series_members_series_id_fk"
  FOREIGN KEY ("series_id") REFERENCES "public"."document_series"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_series_members"
  ADD CONSTRAINT "document_series_members_content_hash_fk"
  FOREIGN KEY ("content_hash") REFERENCES "public"."attachment_documents"("content_hash")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_series_exclusions"
  ADD CONSTRAINT "document_series_exclusions_content_hash_fk"
  FOREIGN KEY ("content_hash") REFERENCES "public"."attachment_documents"("content_hash")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_series_usage_idx"
  ON "document_series" ("usage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_series_members_series_id_idx"
  ON "document_series_members" ("series_id");
