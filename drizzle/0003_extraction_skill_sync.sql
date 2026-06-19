-- Idempotent catch-up for production DBs bootstrapped before extraction skill tables existed.
CREATE TABLE IF NOT EXISTS "extraction_skill_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"concept_name" text NOT NULL,
	"description" text NOT NULL,
	"suggested_fields_json" text DEFAULT '[]' NOT NULL,
	"example_quotes_json" text DEFAULT '[]' NOT NULL,
	"example_email_ids_json" text DEFAULT '[]' NOT NULL,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" text,
	"category" text,
	"user_notes" text,
	"routing_destination_id" text,
	"field_mapping_json" text DEFAULT '{}' NOT NULL,
	"routing_options_json" text DEFAULT '{}' NOT NULL,
	"routing_configured_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
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
DO $$ BEGIN
 ALTER TABLE "extraction_skill_entries" ADD CONSTRAINT "extraction_skill_entries_concept_name_unique" UNIQUE("concept_name");
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "extraction_skill_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extraction_skill_versions" ADD CONSTRAINT "extraction_skill_versions_version_number_unique" UNIQUE("version_number");
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "extraction_skill_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text,
	"action" text NOT NULL,
	"details_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extraction_skill_audit_log" ADD COLUMN IF NOT EXISTS "details_json" text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovered_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"concept_id" text NOT NULL,
	"payload_json" text NOT NULL,
	"source_quote" text,
	"confidence" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extraction_skill_audit_log" ADD CONSTRAINT "extraction_skill_audit_log_entry_id_extraction_skill_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."extraction_skill_entries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discovered_facts" ADD CONSTRAINT "discovered_facts_concept_id_extraction_skill_entries_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."extraction_skill_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
