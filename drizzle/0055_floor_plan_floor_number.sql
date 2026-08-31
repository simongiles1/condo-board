-- Drawing name stays in "name". Floor number is a separate integer used for sorting.
ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "floor_number" integer;
--> statement-breakpoint
-- Prefer "... Floor 12", then a trailing "- 12", then a name that is just a number.
UPDATE "floor_plans"
SET "floor_number" = COALESCE(
  (regexp_match("name", 'floor\s+(-?\d+)\s*$', 'i'))[1]::integer,
  CASE
    WHEN "name" ~ '\s[-–—]\s*-?\d+\s*$'
      THEN (regexp_match("name", '[-–—]\s*(-?\d+)\s*$'))[1]::integer
    WHEN "name" ~ '^-?\d+$'
      THEN "name"::integer
    ELSE NULL
  END,
  "sort_order"
)
WHERE "floor_number" IS NULL;
--> statement-breakpoint
UPDATE "floor_plans"
SET "name" = btrim(regexp_replace("name", '\s*[-–—]\s*floor\s+-?\d+\s*$', '', 'i'))
WHERE "name" ~* '\s*[-–—]\s*floor\s+-?\d+\s*$'
  AND btrim(regexp_replace("name", '\s*[-–—]\s*floor\s+-?\d+\s*$', '', 'i')) <> '';
--> statement-breakpoint
UPDATE "floor_plans"
SET "name" = btrim(regexp_replace("name", '\s*[-–—]\s*-?\d+\s*$', ''))
WHERE "name" ~ '\s[-–—]\s*-?\d+\s*$'
  AND "name" !~* 'floor\s+-?\d+\s*$'
  AND btrim(regexp_replace("name", '\s*[-–—]\s*-?\d+\s*$', '')) <> '';
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ALTER COLUMN "floor_number" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "floor_plans"
  ALTER COLUMN "floor_number" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "floor_plans_family_floor_idx"
  ON "floor_plans" ("family_id", "floor_number");
