ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "body_text_strict_unique" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emails_thread_id_idx" ON "emails" ("thread_id");
