CREATE TABLE IF NOT EXISTS "file_card_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"scope" text DEFAULT 'test' NOT NULL,
	"doc_limit" integer,
	"total_docs" integer DEFAULT 0 NOT NULL,
	"completed_docs" integer DEFAULT 0 NOT NULL,
	"failed_docs" integer DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" text DEFAULT '0' NOT NULL,
	"peak_cost_usd" text DEFAULT '0' NOT NULL,
	"off_peak_cost_usd" text DEFAULT '0' NOT NULL,
	"planned_hashes_json" text DEFAULT '[]' NOT NULL,
	"planned_email_ids_json" text DEFAULT '[]' NOT NULL,
	"current_doc_index" integer DEFAULT 0 NOT NULL,
	"current_label" text,
	"error_message" text,
	"started_at" text NOT NULL,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachment_file_cards" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"document_type" text NOT NULL,
	"summary" text NOT NULL,
	"covering_email_context" text NOT NULL,
	"parties" text DEFAULT '[]' NOT NULL,
	"document_date" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"input_hash" text NOT NULL,
	"input_chars" integer NOT NULL,
	"packed_excerpt" text,
	"model_name" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" text DEFAULT '0' NOT NULL,
	"pricing_tier" text DEFAULT 'off_peak' NOT NULL,
	"billed_at" text NOT NULL,
	"rating" text,
	"notes" text,
	"error" text,
	"run_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_file_cards" (
	"email_id" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"input_hash" text NOT NULL,
	"input_chars" integer NOT NULL,
	"model_name" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" text DEFAULT '0' NOT NULL,
	"pricing_tier" text DEFAULT 'off_peak' NOT NULL,
	"billed_at" text NOT NULL,
	"run_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment_file_cards"
  ADD CONSTRAINT "attachment_file_cards_content_hash_fk"
  FOREIGN KEY ("content_hash") REFERENCES "public"."attachment_documents"("content_hash")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachment_file_cards"
  ADD CONSTRAINT "attachment_file_cards_run_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."file_card_runs"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_file_cards_document_type_idx"
  ON "attachment_file_cards" ("document_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_file_cards_status_idx"
  ON "attachment_file_cards" ("status");
--> statement-breakpoint
ALTER TABLE "email_file_cards"
  ADD CONSTRAINT "email_file_cards_email_id_fk"
  FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_file_cards"
  ADD CONSTRAINT "email_file_cards_run_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."file_card_runs"("id")
  ON DELETE set null ON UPDATE no action;
