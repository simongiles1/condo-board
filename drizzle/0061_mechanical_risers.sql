-- Official mechanical riser type catalog (color + shortcut) and numbered instances.
CREATE TABLE IF NOT EXISTS "mechanical_riser_types" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "color" text NOT NULL,
  "shortcut" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mechanical_risers" (
  "id" text PRIMARY KEY NOT NULL,
  "type_id" text NOT NULL REFERENCES "mechanical_riser_types"("id") ON DELETE RESTRICT,
  "number" integer NOT NULL,
  "created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mechanical_risers_type_number_idx"
  ON "mechanical_risers" ("type_id", "number");
