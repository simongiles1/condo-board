ALTER TABLE "floor_plans" ADD COLUMN IF NOT EXISTS "crop_width_pt" real;
--> statement-breakpoint
ALTER TABLE "floor_plans" ADD COLUMN IF NOT EXISTS "crop_height_pt" real;
--> statement-breakpoint
UPDATE "floor_plans" fp
SET
  "crop_width_pt" = f."crop_width_pt",
  "crop_height_pt" = f."crop_height_pt"
FROM "floor_plan_families" f
WHERE fp."family_id" = f."id"
  AND fp."crop_x_pt" IS NOT NULL
  AND fp."crop_y_pt" IS NOT NULL
  AND fp."crop_width_pt" IS NULL
  AND fp."crop_height_pt" IS NULL
  AND f."crop_width_pt" IS NOT NULL
  AND f."crop_height_pt" IS NOT NULL;
