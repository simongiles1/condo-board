ALTER TABLE "global_todos" ADD COLUMN IF NOT EXISTS "source_kind" text DEFAULT 'meeting' NOT NULL;
--> statement-breakpoint
ALTER TABLE "global_todos" ADD COLUMN IF NOT EXISTS "source_extracted_action_item_id" text;
--> statement-breakpoint
UPDATE "global_todos"
SET "source_kind" = 'manual'
WHERE "source_meeting_id" IS NULL
  AND "source_kind" = 'meeting';
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "global_todos" ADD CONSTRAINT "global_todos_source_extracted_action_item_id_fk" FOREIGN KEY ("source_extracted_action_item_id") REFERENCES "public"."extracted_action_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "global_todos_source_extracted_action_item_unique" ON "global_todos" ("source_extracted_action_item_id");
--> statement-breakpoint
INSERT INTO "global_todos" (
  "id",
  "assignee",
  "role",
  "description",
  "deadline",
  "completed",
  "completed_at",
  "source_meeting_id",
  "source_kind",
  "source_extracted_action_item_id",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  ai.assignee,
  'Email',
  ai.description,
  ai.deadline,
  false,
  NULL,
  NULL,
  'email',
  ai.id,
  ai.created_at,
  ai.created_at
FROM "extracted_action_items" ai
INNER JOIN "extraction_sources" es ON es.id = ai.source_id
INNER JOIN "emails" e ON e.id = es.source_id
WHERE ai.lifecycle_status = 'open'
  AND ai.completed IS FALSE
  AND e.received_at >= to_char((CURRENT_TIMESTAMP AT TIME ZONE 'utc') - INTERVAL '120 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  AND NOT EXISTS (
    SELECT 1
    FROM "global_todos" g
    WHERE g.source_extracted_action_item_id = ai.id
  );
