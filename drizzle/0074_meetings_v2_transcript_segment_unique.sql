-- Deduplicate transcript segments inserted twice (upload seed vs pipeline ingest race).
DELETE FROM "meetings_v2_transcript_segments" AS newer
USING "meetings_v2_transcript_segments" AS older
WHERE newer."meeting_v2_id" = older."meeting_v2_id"
  AND newer."sequence" = older."sequence"
  AND newer."ctid" > older."ctid";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meetings_v2_transcript_segments_meeting_sequence_unique"
  ON "meetings_v2_transcript_segments" ("meeting_v2_id", "sequence");
