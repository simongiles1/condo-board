CREATE TABLE IF NOT EXISTS "organization_manual_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"absorbed_key" text NOT NULL,
	"survivor_key" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_manual_merges_absorbed_key_unique" ON "organization_manual_merges" ("absorbed_key");
