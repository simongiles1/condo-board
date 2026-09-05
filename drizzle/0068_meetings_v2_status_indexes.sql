CREATE INDEX IF NOT EXISTS "meetings_v2_source_artifacts_meeting_idx"
  ON "meetings_v2_source_artifacts" USING btree ("meeting_v2_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_source_artifacts_meeting_type_idx"
  ON "meetings_v2_source_artifacts" USING btree ("meeting_v2_id", "type");
CREATE INDEX IF NOT EXISTS "meetings_v2_transcript_segments_meeting_idx"
  ON "meetings_v2_transcript_segments" USING btree ("meeting_v2_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_document_pages_meeting_idx"
  ON "meetings_v2_document_pages" USING btree ("meeting_v2_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_document_sections_meeting_sort_idx"
  ON "meetings_v2_document_sections" USING btree ("meeting_v2_id", "sort_order");
CREATE INDEX IF NOT EXISTS "meetings_v2_document_chunks_meeting_idx"
  ON "meetings_v2_document_chunks" USING btree ("meeting_v2_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_agenda_snapshots_meeting_idx"
  ON "meetings_v2_agenda_chunk_snapshots" USING btree ("meeting_v2_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_agenda_items_meeting_sort_idx"
  ON "meetings_v2_agenda_items" USING btree ("meeting_v2_id", "sort_order");
CREATE INDEX IF NOT EXISTS "meetings_v2_evidence_meeting_item_idx"
  ON "meetings_v2_agenda_item_evidence" USING btree ("meeting_v2_id", "agenda_item_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_contexts_meeting_item_idx"
  ON "meetings_v2_agenda_item_contexts" USING btree ("meeting_v2_id", "agenda_item_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_investigations_meeting_item_idx"
  ON "meetings_v2_agenda_item_investigations" USING btree ("meeting_v2_id", "agenda_item_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_validations_meeting_item_idx"
  ON "meetings_v2_validation_results" USING btree ("meeting_v2_id", "agenda_item_id");
CREATE INDEX IF NOT EXISTS "meetings_v2_drafts_meeting_created_idx"
  ON "meetings_v2_minutes_drafts" USING btree ("meeting_v2_id", "created_at");
