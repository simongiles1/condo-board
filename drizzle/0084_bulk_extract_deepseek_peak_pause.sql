ALTER TABLE "bulk_extract_runs"
ADD COLUMN IF NOT EXISTS "run_during_deepseek_peak" boolean DEFAULT false NOT NULL;
