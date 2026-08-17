ALTER TABLE "attachment_document_pages"
  ADD COLUMN IF NOT EXISTS "vision_error" text;
--> statement-breakpoint
ALTER TABLE "attachment_document_pages"
  ADD COLUMN IF NOT EXISTS "vision_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "attachment_document_pages"
  ADD COLUMN IF NOT EXISTS "vision_model" text;
--> statement-breakpoint
ALTER TABLE "attachment_document_pages"
  ADD COLUMN IF NOT EXISTS "vision_input_tokens" integer;
--> statement-breakpoint
ALTER TABLE "attachment_document_pages"
  ADD COLUMN IF NOT EXISTS "vision_output_tokens" integer;
--> statement-breakpoint
ALTER TABLE "attachment_document_pages"
  ADD COLUMN IF NOT EXISTS "vision_cost_usd" text;
--> statement-breakpoint
ALTER TABLE "attachment_document_pages"
  ADD COLUMN IF NOT EXISTS "visioned_at" text;
