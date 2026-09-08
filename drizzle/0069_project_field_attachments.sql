CREATE TABLE IF NOT EXISTS "project_field_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_key" text NOT NULL,
	"field" text NOT NULL,
	"attached_value" text NOT NULL,
	"value_key" text NOT NULL,
	"name_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_field_attachments_project_field_value_unique" ON "project_field_attachments" ("project_key","field","value_key");
