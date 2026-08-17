CREATE TABLE IF NOT EXISTS "telegram_review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hold_reason" text NOT NULL,
	"payload_json" text NOT NULL,
	"affiliation_id" text,
	"fingerprint_merge_id" text,
	"telegram_chat_id" text,
	"telegram_message_id" integer,
	"created_at" text NOT NULL,
	"reviewed_at" text,
	"reviewed_via" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_review_items_pending_created_idx" ON "telegram_review_items" ("status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_review_items_affiliation_unique" ON "telegram_review_items" ("affiliation_id") WHERE "affiliation_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "telegram_review_items" ADD CONSTRAINT "telegram_review_items_affiliation_id_person_organization_affiliations_id_fk" FOREIGN KEY ("affiliation_id") REFERENCES "person_organization_affiliations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_review_items" ADD CONSTRAINT "telegram_review_items_fingerprint_merge_id_contact_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "contact_fingerprint_merges"("id") ON DELETE set null ON UPDATE no action;
