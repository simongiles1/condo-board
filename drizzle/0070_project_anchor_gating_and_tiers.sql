ALTER TABLE "project_entities" ADD COLUMN IF NOT EXISTS "tier" text DEFAULT 'service_call' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_entities" ADD COLUMN IF NOT EXISTS "anchor_type" text;--> statement-breakpoint
ALTER TABLE "project_entities" ADD COLUMN IF NOT EXISTS "anchor_id" text;--> statement-breakpoint
ALTER TABLE "project_entities" ADD COLUMN IF NOT EXISTS "equipment_ids" text[];--> statement-breakpoint
ALTER TABLE "project_entities" ADD COLUMN IF NOT EXISTS "completed_at" text;--> statement-breakpoint
ALTER TABLE "project_entities" ADD COLUMN IF NOT EXISTS "promotion_reasons_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_entities_anchor_idx" ON "project_entities" ("anchor_type", "anchor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_entities_tier_idx" ON "project_entities" ("tier");--> statement-breakpoint
ALTER TABLE "project_mentions" ADD COLUMN IF NOT EXISTS "extracted_anchor_type" text;--> statement-breakpoint
ALTER TABLE "project_mentions" ADD COLUMN IF NOT EXISTS "extracted_anchor_hint" text;--> statement-breakpoint
ALTER TABLE "project_mentions" ADD COLUMN IF NOT EXISTS "resolved_anchor_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_mentions_resolved_anchor_idx" ON "project_mentions" ("resolved_anchor_id");
