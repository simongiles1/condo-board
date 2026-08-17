CREATE TABLE IF NOT EXISTS "organization_highlight_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"model_id" text NOT NULL,
	"extraction_json" text NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"updated_at" text NOT NULL,
	"second_pass_extraction_json" text,
	"second_pass_skipped" boolean DEFAULT false NOT NULL,
	"second_pass_error" text,
	"second_pass_input_tokens" integer,
	"second_pass_output_tokens" integer,
	"second_pass_total_tokens" integer,
	"second_pass_cost_usd" text,
	"second_pass_api_model_name" text,
	"second_pass_updated_at" text,
	"third_pass_extraction_json" text,
	"third_pass_skipped" boolean DEFAULT false NOT NULL,
	"third_pass_error" text,
	"third_pass_input_tokens" integer,
	"third_pass_output_tokens" integer,
	"third_pass_total_tokens" integer,
	"third_pass_cost_usd" text,
	"third_pass_api_model_name" text,
	"third_pass_updated_at" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_highlight_extractions" ADD CONSTRAINT "organization_highlight_extractions_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_highlight_extractions_email_model_unique" ON "organization_highlight_extractions" ("email_id", "model_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_fingerprint_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"email_ids_key" text NOT NULL,
	"email_ids_json" text NOT NULL,
	"entity_cards_json" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"error" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_fingerprint_merges_model_emails_unique" ON "organization_fingerprint_merges" ("model_id", "email_ids_key");
