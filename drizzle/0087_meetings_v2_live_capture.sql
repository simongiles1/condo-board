CREATE TABLE IF NOT EXISTS "meetings_v2_live_capture_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"session_id" text NOT NULL,
	"participant_identity" text NOT NULL,
	"track_sid" text NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"unpublished_at" text,
	"egress_id" text,
	"file_location" text,
	"file_started_at" text,
	"file_duration_ms" integer,
	"file_opened_at" text,
	"clock_delta_ms" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "meetings_v2_live_capture_tracks_sid_unique" UNIQUE ("session_id", "track_sid")
);
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_capture_tracks"
  ADD CONSTRAINT "meetings_v2_live_capture_tracks_meeting_fk"
  FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_capture_tracks"
  ADD CONSTRAINT "meetings_v2_live_capture_tracks_session_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."meetings_v2_live_sessions"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meetings_v2_live_capture_gaps" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"session_id" text NOT NULL,
	"detection" text NOT NULL,
	"participant_identity" text,
	"track_sid" text,
	"egress_id" text,
	"start_offset_ms" integer NOT NULL,
	"end_offset_ms" integer,
	"detail" text NOT NULL,
	"accepted_at" text,
	"accepted_by_identity" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_capture_gaps"
  ADD CONSTRAINT "meetings_v2_live_capture_gaps_meeting_fk"
  FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_capture_gaps"
  ADD CONSTRAINT "meetings_v2_live_capture_gaps_session_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."meetings_v2_live_sessions"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_v2_live_capture_gaps_session_idx"
  ON "meetings_v2_live_capture_gaps" ("session_id");
