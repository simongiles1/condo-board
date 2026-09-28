CREATE TABLE IF NOT EXISTS "meetings_v2_live_recognition_corrections" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_v2_id" text NOT NULL REFERENCES "meetings_v2"("id") ON DELETE CASCADE,
  "session_id" text NOT NULL REFERENCES "meetings_v2_live_sessions"("id") ON DELETE CASCADE,
  "cue_id" text NOT NULL REFERENCES "meetings_v2_live_recognition_cues"("id") ON DELETE CASCADE,
  "heard_text" text NOT NULL,
  "proposed_text" text NOT NULL,
  "source" text NOT NULL,
  "status" text NOT NULL DEFAULT 'proposed',
  "created_by_identity" text NOT NULL,
  "created_at" text NOT NULL,
  "decided_by_identity" text,
  "decided_at" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_v2_live_recognition_corrections_cue_idx"
  ON "meetings_v2_live_recognition_corrections" ("cue_id");
