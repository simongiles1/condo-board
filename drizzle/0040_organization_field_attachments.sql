CREATE TABLE IF NOT EXISTS "organization_field_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_key" text NOT NULL,
	"field" text NOT NULL,
	"attached_value" text NOT NULL,
	"value_key" text NOT NULL,
	"name_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_field_attachments_org_field_value_unique" ON "organization_field_attachments" ("org_key","field","value_key");
