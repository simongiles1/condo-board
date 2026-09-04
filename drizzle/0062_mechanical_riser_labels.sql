-- Allow alphanumeric riser labels (e.g. B11) instead of integers only.
DROP INDEX IF EXISTS "mechanical_risers_type_number_idx";
--> statement-breakpoint
ALTER TABLE "mechanical_risers" RENAME COLUMN "number" TO "label";
--> statement-breakpoint
ALTER TABLE "mechanical_risers" ALTER COLUMN "label" TYPE text USING "label"::text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mechanical_risers_type_label_idx"
  ON "mechanical_risers" ("type_id", "label");
