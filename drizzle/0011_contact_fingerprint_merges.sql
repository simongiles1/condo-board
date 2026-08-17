CREATE TABLE IF NOT EXISTS "contact_fingerprint_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"email_ids_key" text NOT NULL,
	"email_ids_json" text NOT NULL,
	"entity_cards_json" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"error" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_fingerprint_merges_model_emails_unique" ON "contact_fingerprint_merges" ("model_id", "email_ids_key");
