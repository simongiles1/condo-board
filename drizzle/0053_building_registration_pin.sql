-- One registration pin for the building (original-PDF space), not per family.
ALTER TABLE "floor_plan_settings"
  ADD COLUMN IF NOT EXISTS "pin_x_pt" real,
  ADD COLUMN IF NOT EXISTS "pin_y_pt" real,
  ADD COLUMN IF NOT EXISTS "registration_plan_id" text REFERENCES "floor_plans"("id") ON DELETE SET NULL;

-- Family plate pin was in cropped-plate coordinates. Convert each cropped
-- sheet to original-page coordinates: origin + plate pin.
UPDATE "floor_plans" AS p
SET
  "pin_x_pt" = p."crop_x_pt" + f."pin_x_pt",
  "pin_y_pt" = p."crop_y_pt" + f."pin_y_pt"
FROM "floor_plan_families" AS f
WHERE p."family_id" = f."id"
  AND f."pin_x_pt" IS NOT NULL
  AND f."pin_y_pt" IS NOT NULL
  AND p."crop_x_pt" IS NOT NULL
  AND p."crop_y_pt" IS NOT NULL;

-- Canonical building pin: earliest family that already had a registration pin.
UPDATE "floor_plan_settings" AS s
SET
  "pin_x_pt" = sub."pin_x_pt",
  "pin_y_pt" = sub."pin_y_pt",
  "registration_plan_id" = sub."id"
FROM (
  SELECT
    p."id",
    p."pin_x_pt",
    p."pin_y_pt"
  FROM "floor_plans" AS p
  INNER JOIN "floor_plan_families" AS f ON f."id" = p."family_id"
  WHERE p."pin_x_pt" IS NOT NULL AND p."pin_y_pt" IS NOT NULL
  ORDER BY f."sort_order", p."sort_order", p."name", p."id"
  LIMIT 1
) AS sub
WHERE s."id" = 'default';

ALTER TABLE "floor_plan_families"
  DROP COLUMN IF EXISTS "pin_x_pt",
  DROP COLUMN IF EXISTS "pin_y_pt",
  DROP COLUMN IF EXISTS "registration_plan_id";
