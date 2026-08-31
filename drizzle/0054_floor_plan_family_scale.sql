-- Architectural drawing scale per family (e.g. 150 for 1:150 podium, 50 for 1:50 tower).
ALTER TABLE "floor_plan_families"
  ADD COLUMN IF NOT EXISTS "scale_denominator" real;
