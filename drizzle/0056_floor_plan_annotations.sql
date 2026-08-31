ALTER TABLE "floor_plans"
  ADD COLUMN IF NOT EXISTS "annotations_json" text NOT NULL DEFAULT '[]';
