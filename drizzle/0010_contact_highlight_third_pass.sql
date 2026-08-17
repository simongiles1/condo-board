ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_extraction_json" text;
--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_skipped" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_error" text;
--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_input_tokens" integer;
--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_output_tokens" integer;
--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_total_tokens" integer;
--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_cost_usd" text;
--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_api_model_name" text;
--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD COLUMN IF NOT EXISTS "third_pass_updated_at" text;
