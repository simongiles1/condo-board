CREATE TABLE IF NOT EXISTS "floor_plan_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_label" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
INSERT INTO "floor_plan_settings" ("id", "registration_label", "updated_at")
VALUES ('default', 'NW corner of Elevator A', '2026-08-25T00:00:00.000Z')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floor_plan_families" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"crop_width_pt" real,
	"crop_height_pt" real,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floor_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"original_file_path" text NOT NULL,
	"cropped_file_path" text,
	"original_page_width_pt" real NOT NULL,
	"original_page_height_pt" real NOT NULL,
	"crop_x_pt" real,
	"crop_y_pt" real,
	"pin_x_pt" real,
	"pin_y_pt" real,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_family_id_floor_plan_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."floor_plan_families"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "floor_plans_family_idx" ON "floor_plans" ("family_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "floor_plans_family_sort_idx" ON "floor_plans" ("family_id", "sort_order");
