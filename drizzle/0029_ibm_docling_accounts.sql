CREATE TABLE IF NOT EXISTS "ibm_docling_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"trial_pages" integer DEFAULT 5000 NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

ALTER TABLE "docling_backfill_runs" ADD COLUMN IF NOT EXISTS "ibm_account_id" text;
