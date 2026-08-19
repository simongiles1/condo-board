CREATE TABLE IF NOT EXISTS "contact_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"source_email_id" text,
	"fingerprint_merge_id" text,
	"model_id" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"job_title" text,
	"raw_company" text,
	"mention_kind" text DEFAULT 'unknown' NOT NULL,
	"fingerprint" text NOT NULL,
	"first_name_key" text,
	"first_org_key" text,
	"blocking_keys_json" text DEFAULT '[]' NOT NULL,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolved_person_id" text,
	"resolved_organization_id" text,
	"resolution_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_mentions" ADD CONSTRAINT "contact_mentions_source_email_id_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_mentions" ADD CONSTRAINT "contact_mentions_fingerprint_merge_id_contact_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."contact_fingerprint_merges"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_mentions" ADD CONSTRAINT "contact_mentions_resolved_person_id_contact_persons_id_fk" FOREIGN KEY ("resolved_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_mentions" ADD CONSTRAINT "contact_mentions_resolved_organization_id_organization_entities_id_fk" FOREIGN KEY ("resolved_organization_id") REFERENCES "public"."organization_entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_mentions_email_fingerprint_unique" ON "contact_mentions" ("source_email_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_mentions_status_idx" ON "contact_mentions" ("resolution_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_mentions_first_name_key_idx" ON "contact_mentions" ("first_name_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_mentions_first_org_key_idx" ON "contact_mentions" ("first_org_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_mentions_resolved_person_idx" ON "contact_mentions" ("resolved_person_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_mentions_email_idx" ON "contact_mentions" ("email");
