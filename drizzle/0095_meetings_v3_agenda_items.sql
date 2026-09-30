CREATE TABLE IF NOT EXISTS "meetings_v3_agenda_items" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_v2_id" text NOT NULL REFERENCES "meetings_v2"("id") ON DELETE CASCADE,
  "sort_order" integer NOT NULL,
  "item_number" text NOT NULL,
  "title" text NOT NULL,
  "section_label" text NOT NULL,
  "item_type" text NOT NULL,
  "source_pages_json" text NOT NULL,
  "summary" text,
  "amount" text,
  "vendors_json" text,
  "recommendation" text,
  "created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_v3_agenda_items_meeting_idx"
  ON "meetings_v3_agenda_items" ("meeting_v2_id", "sort_order");
