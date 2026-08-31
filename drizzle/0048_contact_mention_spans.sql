ALTER TABLE "contact_mentions" ADD COLUMN IF NOT EXISTS "candidate_person_ids_json" text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "contact_mentions" ADD COLUMN IF NOT EXISTS "start_offset" integer;
--> statement-breakpoint
ALTER TABLE "contact_mentions" ADD COLUMN IF NOT EXISTS "end_offset" integer;
