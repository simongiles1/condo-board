CREATE TABLE IF NOT EXISTS "meetings_v3_page_rewrites" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_v2_id" text NOT NULL REFERENCES "meetings_v2"("id") ON DELETE CASCADE,
  "page_number" integer NOT NULL,
  "corrected_text" text NOT NULL,
  "created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meetings_v3_page_rewrites_meeting_page_unique"
  ON "meetings_v3_page_rewrites" ("meeting_v2_id", "page_number");
