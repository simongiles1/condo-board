-- Per-sheet content crops for east/west mechanical merge (title block / frame masks).
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "west_crop_x_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "west_crop_y_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "west_crop_width_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "west_crop_height_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_crop_x_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_crop_y_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_crop_width_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "east_crop_height_pt" real;
