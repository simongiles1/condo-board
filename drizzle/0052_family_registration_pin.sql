-- One registration pin per floor-plan family (shared plate coordinates).
ALTER TABLE "floor_plan_families"
  ADD COLUMN "pin_x_pt" real,
  ADD COLUMN "pin_y_pt" real,
  ADD COLUMN "registration_plan_id" text REFERENCES "floor_plans"("id") ON DELETE SET NULL;

-- Migrate existing per-plan pins to the family level (first pinned plan wins).
UPDATE "floor_plan_families" AS f
SET
  "pin_x_pt" = sub."pin_x_pt",
  "pin_y_pt" = sub."pin_y_pt",
  "registration_plan_id" = sub."id"
FROM (
  SELECT DISTINCT ON (p."family_id")
    p."family_id",
    p."id",
    p."pin_x_pt",
    p."pin_y_pt"
  FROM "floor_plans" AS p
  WHERE p."pin_x_pt" IS NOT NULL AND p."pin_y_pt" IS NOT NULL
  ORDER BY p."family_id", p."sort_order", p."name", p."id"
) AS sub
WHERE f."id" = sub."family_id";
