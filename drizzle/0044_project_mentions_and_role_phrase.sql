ALTER TABLE "contact_mentions" ADD COLUMN IF NOT EXISTS "role_phrase" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"source_email_id" text,
	"fingerprint_merge_id" text,
	"model_id" text,
	"raw_name" text NOT NULL,
	"contractor" text,
	"year_hint" text,
	"phase" text,
	"location" text,
	"name_key" text,
	"identity_key" text,
	"fingerprint" text NOT NULL,
	"minted" boolean DEFAULT false NOT NULL,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolved_project_id" text,
	"resolution_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_mentions" ADD CONSTRAINT "project_mentions_source_email_id_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_mentions" ADD CONSTRAINT "project_mentions_fingerprint_merge_id_project_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."project_fingerprint_merges"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_mentions" ADD CONSTRAINT "project_mentions_resolved_project_id_project_entities_id_fk" FOREIGN KEY ("resolved_project_id") REFERENCES "public"."project_entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_mentions_email_fingerprint_unique" ON "project_mentions" ("source_email_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_mentions_status_idx" ON "project_mentions" ("resolution_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_mentions_name_key_idx" ON "project_mentions" ("name_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_mentions_identity_key_idx" ON "project_mentions" ("identity_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_mentions_resolved_project_idx" ON "project_mentions" ("resolved_project_id");
