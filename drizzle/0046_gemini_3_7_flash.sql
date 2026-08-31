ALTER TABLE "analysis_settings" ALTER COLUMN "analysis_model" SET DEFAULT 'gemini-3.7-flash';

UPDATE "analysis_settings"
SET
  "analysis_model" = 'gemini-3.7-flash',
  "updated_at" = (timezone('utc', now()))::text
WHERE "analysis_model" IN (
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-3.6-flash'
);
