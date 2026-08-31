ALTER TABLE "project_entities" ADD COLUMN IF NOT EXISTS "aliases_json" text DEFAULT '[]' NOT NULL;
