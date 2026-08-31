-- Mechanical drawing families plus east/west split sheets that merge into one original.
ALTER TABLE "floor_plan_families"
  ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'architectural' NOT NULL;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ALTER COLUMN "original_file_path" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "west_file_path" text;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_file_path" text;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "west_page_width_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "west_page_height_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_page_width_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_page_height_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_offset_x_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_offset_y_pt" real;
