-- Track which catalog risers have been traced to their top floor.
ALTER TABLE "mechanical_risers" ADD COLUMN IF NOT EXISTS "completed" boolean NOT NULL DEFAULT false;
