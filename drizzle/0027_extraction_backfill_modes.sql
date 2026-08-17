ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'docling_only' NOT NULL;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "phase" text;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "total_docling_pages" integer DEFAULT 0 NOT NULL;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "total_vision_pages" integer DEFAULT 0 NOT NULL;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "completed_docling_pages" integer DEFAULT 0 NOT NULL;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "completed_vision_pages" integer DEFAULT 0 NOT NULL;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "vision_cost_usd" text DEFAULT '0' NOT NULL;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "corpus_pending_vision_pages" integer DEFAULT 0 NOT NULL;
ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "corpus_pending_vision_docs" integer DEFAULT 0 NOT NULL;
