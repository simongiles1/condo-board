-- Idempotent catch-up for production DBs that predate full email-analysis schema.
CREATE TABLE IF NOT EXISTS "entity_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_value" text NOT NULL,
	"context" text,
	"contact_email" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"organization_role" text,
	"vendor_candidate" boolean DEFAULT false NOT NULL,
	"dedup_key" text,
	"person_title" text,
	"linked_organization_name" text,
	"source_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "context" text;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "contact_email" text;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "organization_role" text;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "vendor_candidate" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "dedup_key" text;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "person_title" text;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "linked_organization_name" text;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "source_id" text;
--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD COLUMN IF NOT EXISTS "created_at" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_exclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_value" text NOT NULL,
	"dedup_key" text NOT NULL,
	"note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_exclusions" ADD COLUMN IF NOT EXISTS "dedup_key" text;
--> statement-breakpoint
ALTER TABLE "entity_exclusions" ADD COLUMN IF NOT EXISTS "note" text;
--> statement-breakpoint
ALTER TABLE "entity_exclusions" ADD COLUMN IF NOT EXISTS "created_at" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_role_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_role_definitions" ADD CONSTRAINT "organization_role_definitions_label_unique" UNIQUE("label");
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "concept_name" text;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "first_seen_at" text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "last_seen_at" text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "created_at" text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "updated_at" text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "suggested_fields_json" text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "example_quotes_json" text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "example_email_ids_json" text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "occurrence_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "merged_into_id" text;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "user_notes" text;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "routing_destination_id" text;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "field_mapping_json" text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "routing_options_json" text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "extraction_skill_entries" ADD COLUMN IF NOT EXISTS "routing_configured_at" text;
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'approved' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "organization_role" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
