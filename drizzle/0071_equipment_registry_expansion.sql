ALTER TABLE "building_equipment_registry" ADD COLUMN IF NOT EXISTS "aliases_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "building_equipment_registry" ADD COLUMN IF NOT EXISTS "component_keywords_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "building_equipment_registry" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "building_equipment_registry" ADD COLUMN IF NOT EXISTS "parent_equipment_id" text;--> statement-breakpoint
ALTER TABLE "building_equipment_registry" ADD COLUMN IF NOT EXISTS "updated_at" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "building_equipment_registry_status_idx" ON "building_equipment_registry" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "building_equipment_registry_category_idx" ON "building_equipment_registry" ("category");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"source_email_id" text,
	"model_id" text,
	"raw_name" text NOT NULL,
	"extracted_role" text,
	"parent_system_hint" text,
	"category" text,
	"resolved_equipment_id" text,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolution_reason" text,
	"confidence" text,
	"source_quote" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_mentions" ADD CONSTRAINT "equipment_mentions_source_email_id_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_mentions" ADD CONSTRAINT "equipment_mentions_resolved_equipment_id_building_equipment_registry_id_fk" FOREIGN KEY ("resolved_equipment_id") REFERENCES "public"."building_equipment_registry"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_mentions_source_email_idx" ON "equipment_mentions" ("source_email_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_mentions_resolved_equipment_idx" ON "equipment_mentions" ("resolved_equipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_mentions_status_idx" ON "equipment_mentions" ("resolution_status");
