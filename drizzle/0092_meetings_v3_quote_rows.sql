CREATE TABLE IF NOT EXISTS "meetings_v3_quote_rows" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_v2_id" text NOT NULL REFERENCES "meetings_v2"("id") ON DELETE CASCADE,
  "page_number" integer NOT NULL,
  "item_label" text NOT NULL,
  "vendor" text NOT NULL,
  "equipment" text,
  "line_kind" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "tax_basis" text NOT NULL,
  "check_status" text NOT NULL,
  "check_detail" text NOT NULL,
  "created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_v3_quote_rows_meeting_page_idx"
  ON "meetings_v3_quote_rows" ("meeting_v2_id", "page_number");
