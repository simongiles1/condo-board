CREATE TABLE IF NOT EXISTS "contact_person_field_denials" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"field" text NOT NULL,
	"denied_value" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_person_field_denials_person_field_value_unique" ON "contact_person_field_denials" ("person_id","field","denied_value");
