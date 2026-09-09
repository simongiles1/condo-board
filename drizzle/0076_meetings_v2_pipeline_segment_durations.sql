CREATE TABLE IF NOT EXISTS "meetings_v2_pipeline_segment_durations" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"segment" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"recorded_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings_v2_pipeline_segment_durations"
  ADD CONSTRAINT "meetings_v2_pipeline_segment_durations_meeting_v2_id_meetings_v2_id_fk"
  FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_v2_pipeline_segment_durations_segment_idx"
  ON "meetings_v2_pipeline_segment_durations" ("segment");
