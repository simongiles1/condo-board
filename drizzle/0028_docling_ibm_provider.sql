ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "docling_provider" text DEFAULT 'sidecar' NOT NULL;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "docling_cost_usd" text DEFAULT '0' NOT NULL;
