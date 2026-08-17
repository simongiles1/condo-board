CREATE TABLE IF NOT EXISTS "event_highlight_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"model_id" text NOT NULL,
	"extraction_json" text NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"persist_source_id" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_highlight_extractions" ADD CONSTRAINT "event_highlight_extractions_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_highlight_extractions" ADD CONSTRAINT "event_highlight_extractions_persist_source_id_fk" FOREIGN KEY ("persist_source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_highlight_extractions_email_model_unique" ON "event_highlight_extractions" ("email_id", "model_id");
