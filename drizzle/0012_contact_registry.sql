CREATE TABLE IF NOT EXISTS "contact_persons" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"mention_weight" integer DEFAULT 0 NOT NULL,
	"sparse_stub" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_person_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"email" text NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_person_phones" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"phone" text NOT NULL,
	"phone_normalized" text NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_person_titles" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"title" text NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_email_index" (
	"email" text PRIMARY KEY NOT NULL,
	"current_person_id" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_merge_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"incoming_card_json" text NOT NULL,
	"target_person_id" text,
	"result_person_id" text,
	"decision_json" text NOT NULL,
	"model_id" text,
	"fingerprint_merge_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_registry_ingests" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint_merge_id" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"persons_created" integer DEFAULT 0 NOT NULL,
	"decisions_applied" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" text NOT NULL,
	"completed_at" text,
	CONSTRAINT "contact_registry_ingests_fingerprint_merge_id_unique" UNIQUE("fingerprint_merge_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_person_emails" ADD CONSTRAINT "contact_person_emails_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_person_phones" ADD CONSTRAINT "contact_person_phones_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_person_titles" ADD CONSTRAINT "contact_person_titles_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_email_index" ADD CONSTRAINT "contact_email_index_current_person_id_contact_persons_id_fk" FOREIGN KEY ("current_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_merge_proposals" ADD CONSTRAINT "contact_merge_proposals_target_person_id_contact_persons_id_fk" FOREIGN KEY ("target_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_merge_proposals" ADD CONSTRAINT "contact_merge_proposals_result_person_id_contact_persons_id_fk" FOREIGN KEY ("result_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_merge_proposals" ADD CONSTRAINT "contact_merge_proposals_fingerprint_merge_id_contact_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."contact_fingerprint_merges"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_registry_ingests" ADD CONSTRAINT "contact_registry_ingests_fingerprint_merge_id_contact_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."contact_fingerprint_merges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_person_emails_email_idx" ON "contact_person_emails" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_person_emails_person_idx" ON "contact_person_emails" ("person_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_person_phones_normalized_idx" ON "contact_person_phones" ("phone_normalized");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_persons_mention_weight_idx" ON "contact_persons" ("mention_weight");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_persons_name_idx" ON "contact_persons" ("last_name", "first_name");
