CREATE TABLE IF NOT EXISTS "contact_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"person_dedup_key" text NOT NULL,
	"person_name" text NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"context" text,
	"source_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_emails_person_email_unique" ON "contact_emails" ("person_dedup_key", "email");
--> statement-breakpoint
INSERT INTO "contact_emails" ("id", "email", "person_dedup_key", "person_name", "review_status", "context", "source_id", "created_at")
SELECT
	gen_random_uuid()::text,
	LOWER(TRIM("contact_email")),
	COALESCE("dedup_key", 'person:' || LOWER(TRIM("entity_value"))),
	"entity_value",
	'approved',
	NULL,
	NULL,
	COALESCE("created_at", NOW()::text)
FROM "entity_mentions"
WHERE "review_status" = 'approved'
	AND "entity_type" = 'person'
	AND "contact_email" IS NOT NULL
	AND TRIM("contact_email") <> ''
ON CONFLICT DO NOTHING;
