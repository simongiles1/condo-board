CREATE TABLE IF NOT EXISTS "meetings_v2_item_debug_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"agenda_item_id" text NOT NULL,
	"status" text NOT NULL DEFAULT 'idle',
	"error" text,
	"steps_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"total_input_tokens" integer NOT NULL DEFAULT 0,
	"total_output_tokens" integer NOT NULL DEFAULT 0,
	"total_cost_usd" text NOT NULL DEFAULT '0',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings_v2_item_debug_runs"
  ADD CONSTRAINT "meetings_v2_item_debug_runs_meeting_v2_id_meetings_v2_id_fk"
  FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meetings_v2_item_debug_runs"
  ADD CONSTRAINT "meetings_v2_item_debug_runs_agenda_item_id_meetings_v2_agenda_items_id_fk"
  FOREIGN KEY ("agenda_item_id") REFERENCES "public"."meetings_v2_agenda_items"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_v2_item_debug_runs_item_created_idx"
  ON "meetings_v2_item_debug_runs" ("meeting_v2_id", "agenda_item_id", "created_at");
