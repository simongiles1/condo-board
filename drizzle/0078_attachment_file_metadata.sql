ALTER TABLE "attachment_documents"
  ADD COLUMN IF NOT EXISTS "file_metadata_json" text;
