CREATE TABLE IF NOT EXISTS "organization_field_denials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_key" text NOT NULL,
	"field" text NOT NULL,
	"denied_value" text NOT NULL,
	"name_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_field_denials_org_field_value_unique" ON "organization_field_denials" ("org_key","field","denied_value");
