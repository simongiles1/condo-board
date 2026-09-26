ALTER TABLE "meetings_v2"
  ADD COLUMN IF NOT EXISTS "live_page_map_checked_at" text,
  ADD COLUMN IF NOT EXISTS "live_page_map_checked_by_identity" text,
  ADD COLUMN IF NOT EXISTS "live_page_map_checked_by_name" text;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_sessions"
  ADD COLUMN IF NOT EXISTS "presenter_identity" text,
  ADD COLUMN IF NOT EXISTS "presenter_display_name" text,
  ADD COLUMN IF NOT EXISTS "presented_page" integer;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_navigation_events"
  ALTER COLUMN "agenda_item_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_navigation_events"
  ADD COLUMN IF NOT EXISTS "unscheduled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_navigation_events"
  DROP CONSTRAINT IF EXISTS "meetings_v2_live_nav_target_check";
--> statement-breakpoint
ALTER TABLE "meetings_v2_live_navigation_events"
  ADD CONSTRAINT "meetings_v2_live_nav_target_check"
  CHECK (
    ("unscheduled" = true AND "agenda_item_id" IS NULL)
    OR ("unscheduled" = false AND "agenda_item_id" IS NOT NULL)
  );
