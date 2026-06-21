ALTER TABLE "equipment_assets" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'equipment' NOT NULL;
--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN IF NOT EXISTS "significance" text DEFAULT 'major' NOT NULL;
--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN IF NOT EXISTS "manufacturer" text;
--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN IF NOT EXISTS "aliases_json" text;
--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN IF NOT EXISTS "canonical_id" text;
--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN IF NOT EXISTS "confidence" text;
--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'extracted' NOT NULL;
--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN IF NOT EXISTS "registry_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_canonical_id_equipment_assets_id_fk" FOREIGN KEY ("canonical_id") REFERENCES "public"."equipment_assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "building_equipment_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"floor" integer,
	"location" text,
	"drawing_reference" text,
	"category" text,
	"specs_json" text,
	"position_json" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_registry_id_building_equipment_registry_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."building_equipment_registry"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
