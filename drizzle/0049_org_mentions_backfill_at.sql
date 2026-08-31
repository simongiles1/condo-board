ALTER TABLE "organization_highlight_extractions" ADD COLUMN IF NOT EXISTS "org_mentions_backfilled_at" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_highlight_extractions_org_mentions_backfilled_at_idx" ON "organization_highlight_extractions" ("org_mentions_backfilled_at");
