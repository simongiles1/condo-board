-- Standardized riser templates (size, shape, circles) per riser type.
ALTER TABLE "floor_plan_settings" ADD COLUMN IF NOT EXISTS "riser_templates_json" text;
