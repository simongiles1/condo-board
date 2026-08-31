-- Structural reference anchor for cross-floor pin calibration.
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "reference_anchor_x_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "reference_anchor_y_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plan_settings"
  ADD COLUMN IF NOT EXISTS "pin_reference_plan_id" text;
