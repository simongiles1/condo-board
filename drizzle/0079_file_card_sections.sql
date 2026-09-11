ALTER TABLE "attachment_file_cards"
  ADD COLUMN IF NOT EXISTS "sections_json" text DEFAULT '[]' NOT NULL;
