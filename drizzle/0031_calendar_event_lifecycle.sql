ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "source_quote" text;
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'scheduled' NOT NULL;

UPDATE "calendar_events" SET "status" = 'scheduled' WHERE "status" IS NULL;

ALTER TABLE "extracted_action_items" ADD COLUMN IF NOT EXISTS "related_event_id" text;

DO $$ BEGIN
 ALTER TABLE "extracted_action_items" ADD CONSTRAINT "extracted_action_items_related_event_id_calendar_events_id_fk" FOREIGN KEY ("related_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
