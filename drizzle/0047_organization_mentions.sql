CREATE TABLE IF NOT EXISTS "organization_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"source_email_id" text,
	"fingerprint_merge_id" text,
	"model_id" text,
	"raw_name" text NOT NULL,
	"name_key" text,
	"email" text,
	"phone" text,
	"website" text,
	"fingerprint" text NOT NULL,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolved_organization_id" text,
	"resolution_reason" text,
	"candidate_organization_ids_json" text DEFAULT '[]' NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_mentions" ADD CONSTRAINT "organization_mentions_source_email_id_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_mentions" ADD CONSTRAINT "organization_mentions_fingerprint_merge_id_organization_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."organization_fingerprint_merges"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_mentions" ADD CONSTRAINT "organization_mentions_resolved_organization_id_organization_entities_id_fk" FOREIGN KEY ("resolved_organization_id") REFERENCES "public"."organization_entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_mentions_email_fingerprint_unique" ON "organization_mentions" ("source_email_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_mentions_status_idx" ON "organization_mentions" ("resolution_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_mentions_name_key_idx" ON "organization_mentions" ("name_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_mentions_resolved_org_idx" ON "organization_mentions" ("resolved_organization_id");
