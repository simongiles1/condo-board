CREATE TABLE IF NOT EXISTS "meetings_v2_live_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"room_name" text NOT NULL,
	"media_started_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "meetings_v2_live_sessions_meeting_unique" UNIQUE ("meeting_v2_id"),
	CONSTRAINT "meetings_v2_live_sessions_room_unique" UNIQUE ("room_name")
);
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_sessions"
  ADD CONSTRAINT "meetings_v2_live_sessions_meeting_fk"
  FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meetings_v2_live_navigation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"session_id" text NOT NULL,
	"agenda_item_id" text NOT NULL,
	"media_offset_ms" integer NOT NULL,
	"actor_identity" text NOT NULL,
	"actor_user_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_navigation_events"
  ADD CONSTRAINT "meetings_v2_live_nav_meeting_fk"
  FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_navigation_events"
  ADD CONSTRAINT "meetings_v2_live_nav_session_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."meetings_v2_live_sessions"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_navigation_events"
  ADD CONSTRAINT "meetings_v2_live_nav_item_fk"
  FOREIGN KEY ("agenda_item_id") REFERENCES "public"."meetings_v2_agenda_items"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_navigation_events"
  ADD CONSTRAINT "meetings_v2_live_nav_actor_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_v2_live_nav_session_offset_idx"
  ON "meetings_v2_live_navigation_events" ("session_id", "media_offset_ms");
