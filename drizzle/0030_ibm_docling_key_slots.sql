ALTER TABLE "ibm_docling_accounts" ADD COLUMN IF NOT EXISTS "env_slot" integer;
ALTER TABLE "ibm_docling_accounts" ADD COLUMN IF NOT EXISTS "instance_hint" text;
ALTER TABLE "ibm_docling_accounts" ADD COLUMN IF NOT EXISTS "key_fingerprint" text;
ALTER TABLE "ibm_docling_accounts" ADD COLUMN IF NOT EXISTS "exhausted_at" text;
ALTER TABLE "ibm_docling_accounts" ADD COLUMN IF NOT EXISTS "exhausted_reason" text;
ALTER TABLE "ibm_docling_accounts" ADD COLUMN IF NOT EXISTS "billed_pages" integer DEFAULT 0 NOT NULL;
ALTER TABLE "ibm_docling_accounts" ADD COLUMN IF NOT EXISTS "billed_usd" text DEFAULT '0' NOT NULL;

UPDATE "ibm_docling_accounts"
SET "env_slot" = 1
WHERE "env_slot" IS NULL;

UPDATE "ibm_docling_accounts" AS a
SET
  "billed_pages" = s.pages,
  "billed_usd" = s.usd
FROM (
  SELECT
    coalesce(sum(completed_docling_pages), 0)::int AS pages,
    coalesce(sum(cast(docling_cost_usd as numeric)), 0)::text AS usd
  FROM "docling_backfill_runs"
  WHERE "docling_provider" = 'ibm'
) AS s
WHERE a."env_slot" = 1
  AND a."billed_pages" = 0;

CREATE UNIQUE INDEX IF NOT EXISTS "ibm_docling_accounts_env_slot"
  ON "ibm_docling_accounts" ("env_slot")
  WHERE "env_slot" IS NOT NULL;
