CREATE TABLE IF NOT EXISTS "organization_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_key" text NOT NULL,
	"name" text,
	"organization_role" text,
	"email" text,
	"phone" text,
	"website" text,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_entities_identity_key_unique" ON "organization_entities" ("identity_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_entities_status_idx" ON "organization_entities" ("status");
--> statement-breakpoint
ALTER TABLE "contact_persons" ADD COLUMN IF NOT EXISTS "current_organization_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_organization_affiliations" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"organization_key" text NOT NULL,
	"relation_type" text DEFAULT 'employed_at' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"reviewed_at" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_org_affiliations_person_org_unique" ON "person_organization_affiliations" ("person_id","organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_org_affiliations_person_status_idx" ON "person_organization_affiliations" ("person_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_org_affiliations_org_status_idx" ON "person_organization_affiliations" ("organization_id","status");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_current_organization_id_organization_entities_id_fk" FOREIGN KEY ("current_organization_id") REFERENCES "public"."organization_entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_organization_affiliations" ADD CONSTRAINT "person_organization_affiliations_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_organization_affiliations" ADD CONSTRAINT "person_organization_affiliations_organization_id_organization_entities_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization_entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
