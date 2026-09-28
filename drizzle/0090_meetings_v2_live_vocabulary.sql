ALTER TABLE "meetings_v2_live_recognition_cues"
  ADD COLUMN IF NOT EXISTS "vocabulary_json" text;
