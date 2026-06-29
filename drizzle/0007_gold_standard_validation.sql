ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "gold_standard_file_path" text;
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "gold_standard_validation_json" text;
