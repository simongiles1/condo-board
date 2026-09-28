CREATE TABLE IF NOT EXISTS "meetings_v2_live_recognition_cues" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_v2_id" text NOT NULL REFERENCES "meetings_v2"("id") ON DELETE CASCADE,
  "session_id" text NOT NULL REFERENCES "meetings_v2_live_sessions"("id") ON DELETE CASCADE,
  "start_offset_ms" integer NOT NULL,
  "end_offset_ms" integer NOT NULL,
  "speaker_identity" text NOT NULL,
  "speaker_label" text NOT NULL,
  "text" text NOT NULL,
  "agenda_item_id" text REFERENCES "meetings_v2_agenda_items"("id") ON DELETE SET NULL,
  "created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_v2_live_recognition_cues_session_idx"
  ON "meetings_v2_live_recognition_cues" ("session_id", "start_offset_ms");
