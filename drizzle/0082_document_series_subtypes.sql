ALTER TABLE "document_series_members"
  ADD COLUMN IF NOT EXISTS "subtype_key" text;
--> statement-breakpoint
ALTER TABLE "document_series_members"
  ADD COLUMN IF NOT EXISTS "subtype_title" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_series_members_subtype_idx"
  ON "document_series_members" ("series_id", "subtype_key");
