CREATE TABLE "attachment_document_pages" (
	"content_hash" text NOT NULL,
	"page_no" integer NOT NULL,
	"chars" integer DEFAULT 0 NOT NULL,
	"text_area_ratio" text,
	"image_area_ratio" text,
	"vector_ops" integer DEFAULT 0 NOT NULL,
	"has_text_layer" boolean DEFAULT false NOT NULL,
	"route" text NOT NULL,
	"vision_status" text DEFAULT 'not_needed' NOT NULL,
	"artifact_path" text,
	"vision_error" text,
	"vision_attempts" integer DEFAULT 0 NOT NULL,
	"vision_model" text,
	"vision_input_tokens" integer,
	"vision_output_tokens" integer,
	"vision_cost_usd" text,
	"visioned_at" text,
	"profiler_version" text NOT NULL,
	"profiled_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment_documents" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"ext" text NOT NULL,
	"markdown_path" text,
	"parse_status" text NOT NULL,
	"parse_error" text,
	"parser_name" text,
	"markdown_chars" integer,
	"tokens" integer,
	"page_count" integer,
	"chars_per_page" integer,
	"size_class" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_seen_at" text NOT NULL,
	"parsed_at" text
);
--> statement-breakpoint
CREATE TABLE "building_equipment_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"manufacturer" text,
	"model" text,
	"floor" integer,
	"location" text,
	"drawing_reference" text,
	"category" text,
	"specs_json" text,
	"position_json" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_extract_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"model_id" text NOT NULL,
	"target_scope" text DEFAULT 'all' NOT NULL,
	"status" text NOT NULL,
	"total_threads" integer DEFAULT 0 NOT NULL,
	"total_emails" integer DEFAULT 0 NOT NULL,
	"completed_threads" integer DEFAULT 0 NOT NULL,
	"completed_emails" integer DEFAULT 0 NOT NULL,
	"failed_threads" integer DEFAULT 0 NOT NULL,
	"current_thread_index" integer DEFAULT 0 NOT NULL,
	"current_thread_id" text,
	"current_thread_subject" text,
	"current_email_id" text,
	"current_email_label" text,
	"current_pass" integer,
	"current_email_index" integer,
	"current_email_total" integer,
	"total_cost_usd" text DEFAULT '0' NOT NULL,
	"stint_started_at" text,
	"completed_emails_at_stint_start" integer DEFAULT 0 NOT NULL,
	"active_elapsed_ms" integer DEFAULT 0 NOT NULL,
	"started_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"finished_at" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "contact_email_index" (
	"email" text PRIMARY KEY NOT NULL,
	"current_person_id" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"person_dedup_key" text NOT NULL,
	"person_name" text NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"context" text,
	"source_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_fingerprint_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"email_ids_key" text NOT NULL,
	"email_ids_json" text NOT NULL,
	"entity_cards_json" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"error" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_highlight_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"model_id" text NOT NULL,
	"extraction_json" text NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"updated_at" text NOT NULL,
	"second_pass_extraction_json" text,
	"second_pass_skipped" boolean DEFAULT false NOT NULL,
	"second_pass_error" text,
	"second_pass_input_tokens" integer,
	"second_pass_output_tokens" integer,
	"second_pass_total_tokens" integer,
	"second_pass_cost_usd" text,
	"second_pass_api_model_name" text,
	"second_pass_updated_at" text,
	"third_pass_extraction_json" text,
	"third_pass_skipped" boolean DEFAULT false NOT NULL,
	"third_pass_error" text,
	"third_pass_input_tokens" integer,
	"third_pass_output_tokens" integer,
	"third_pass_total_tokens" integer,
	"third_pass_cost_usd" text,
	"third_pass_api_model_name" text,
	"third_pass_updated_at" text
);
--> statement-breakpoint
CREATE TABLE "contact_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"source_email_id" text,
	"fingerprint_merge_id" text,
	"model_id" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"job_title" text,
	"raw_company" text,
	"mention_kind" text DEFAULT 'unknown' NOT NULL,
	"fingerprint" text NOT NULL,
	"first_name_key" text,
	"first_org_key" text,
	"blocking_keys_json" text DEFAULT '[]' NOT NULL,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"resolved_person_id" text,
	"resolved_organization_id" text,
	"resolution_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_merge_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"incoming_card_json" text NOT NULL,
	"target_person_id" text,
	"result_person_id" text,
	"decision_json" text NOT NULL,
	"model_id" text,
	"fingerprint_merge_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_person_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"email" text NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_person_field_denials" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"field" text NOT NULL,
	"denied_value" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_person_phones" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"phone" text NOT NULL,
	"phone_normalized" text NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_person_titles" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"title" text NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_persons" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"name_aliases_json" text,
	"mention_weight" integer DEFAULT 0 NOT NULL,
	"sparse_stub" boolean DEFAULT false NOT NULL,
	"current_organization_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_registry_ingests" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint_merge_id" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"persons_created" integer DEFAULT 0 NOT NULL,
	"decisions_applied" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" text NOT NULL,
	"completed_at" text,
	CONSTRAINT "contact_registry_ingests_fingerprint_merge_id_unique" UNIQUE("fingerprint_merge_id")
);
--> statement-breakpoint
CREATE TABLE "docling_backfill_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"mode" text DEFAULT 'docling_only' NOT NULL,
	"phase" text,
	"doc_limit" integer,
	"total_docs" integer DEFAULT 0 NOT NULL,
	"total_pages" integer DEFAULT 0 NOT NULL,
	"total_docling_pages" integer DEFAULT 0 NOT NULL,
	"total_vision_pages" integer DEFAULT 0 NOT NULL,
	"corpus_uncached_pages" integer DEFAULT 0 NOT NULL,
	"corpus_pending_docs" integer DEFAULT 0 NOT NULL,
	"corpus_pending_vision_pages" integer DEFAULT 0 NOT NULL,
	"corpus_pending_vision_docs" integer DEFAULT 0 NOT NULL,
	"completed_docs" integer DEFAULT 0 NOT NULL,
	"completed_pages" integer DEFAULT 0 NOT NULL,
	"completed_docling_pages" integer DEFAULT 0 NOT NULL,
	"completed_vision_pages" integer DEFAULT 0 NOT NULL,
	"failed_docs" integer DEFAULT 0 NOT NULL,
	"docling_provider" text DEFAULT 'sidecar' NOT NULL,
	"ibm_account_id" text,
	"docling_cost_usd" text DEFAULT '0' NOT NULL,
	"vision_cost_usd" text DEFAULT '0' NOT NULL,
	"planned_hashes_json" text DEFAULT '[]' NOT NULL,
	"current_doc_index" integer DEFAULT 0 NOT NULL,
	"current_content_hash" text,
	"current_label" text,
	"current_pages_in_doc" integer,
	"stint_started_at" text,
	"completed_pages_at_stint_start" integer DEFAULT 0 NOT NULL,
	"active_elapsed_ms" integer DEFAULT 0 NOT NULL,
	"started_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"finished_at" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "event_highlight_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"model_id" text NOT NULL,
	"extraction_json" text NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"persist_source_id" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ibm_docling_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"env_slot" integer,
	"instance_hint" text,
	"key_fingerprint" text,
	"trial_pages" integer DEFAULT 5000 NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"exhausted_at" text,
	"exhausted_reason" text,
	"billed_pages" integer DEFAULT 0 NOT NULL,
	"billed_usd" text DEFAULT '0' NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_key" text NOT NULL,
	"name" text,
	"organization_role" text,
	"email" text,
	"phone" text,
	"website" text,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "organization_entities_identity_key_unique" UNIQUE("identity_key")
);
--> statement-breakpoint
CREATE TABLE "organization_field_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_key" text NOT NULL,
	"field" text NOT NULL,
	"attached_value" text NOT NULL,
	"value_key" text NOT NULL,
	"name_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_field_denials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_key" text NOT NULL,
	"field" text NOT NULL,
	"denied_value" text NOT NULL,
	"name_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_fingerprint_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"email_ids_key" text NOT NULL,
	"email_ids_json" text NOT NULL,
	"entity_cards_json" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"error" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_highlight_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"model_id" text NOT NULL,
	"extraction_json" text NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"updated_at" text NOT NULL,
	"second_pass_extraction_json" text,
	"second_pass_skipped" boolean DEFAULT false NOT NULL,
	"second_pass_error" text,
	"second_pass_input_tokens" integer,
	"second_pass_output_tokens" integer,
	"second_pass_total_tokens" integer,
	"second_pass_cost_usd" text,
	"second_pass_api_model_name" text,
	"second_pass_updated_at" text,
	"third_pass_extraction_json" text,
	"third_pass_skipped" boolean DEFAULT false NOT NULL,
	"third_pass_error" text,
	"third_pass_input_tokens" integer,
	"third_pass_output_tokens" integer,
	"third_pass_total_tokens" integer,
	"third_pass_cost_usd" text,
	"third_pass_api_model_name" text,
	"third_pass_updated_at" text
);
--> statement-breakpoint
CREATE TABLE "organization_manual_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"absorbed_key" text NOT NULL,
	"survivor_key" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "organization_manual_merges_absorbed_key_unique" UNIQUE("absorbed_key")
);
--> statement-breakpoint
CREATE TABLE "person_organization_affiliations" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"organization_key" text NOT NULL,
	"relation_type" text DEFAULT 'employed_at' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"reviewed_at" text
);
--> statement-breakpoint
CREATE TABLE "project_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_key" text NOT NULL,
	"name" text,
	"year_hint" text,
	"phase" text,
	"contractor" text,
	"location" text,
	"equipment_mentions" text,
	"scope" text,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_entities_identity_key_unique" UNIQUE("identity_key")
);
--> statement-breakpoint
CREATE TABLE "project_field_denials" (
	"id" text PRIMARY KEY NOT NULL,
	"project_key" text NOT NULL,
	"field" text NOT NULL,
	"denied_value" text NOT NULL,
	"name_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_fingerprint_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"email_ids_key" text NOT NULL,
	"email_ids_json" text NOT NULL,
	"entity_cards_json" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"error" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_highlight_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"model_id" text NOT NULL,
	"extraction_json" text NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"updated_at" text NOT NULL,
	"second_pass_extraction_json" text,
	"second_pass_skipped" boolean DEFAULT false NOT NULL,
	"second_pass_error" text,
	"second_pass_input_tokens" integer,
	"second_pass_output_tokens" integer,
	"second_pass_total_tokens" integer,
	"second_pass_cost_usd" text,
	"second_pass_api_model_name" text,
	"second_pass_updated_at" text,
	"third_pass_extraction_json" text,
	"third_pass_skipped" boolean DEFAULT false NOT NULL,
	"third_pass_error" text,
	"third_pass_input_tokens" integer,
	"third_pass_output_tokens" integer,
	"third_pass_total_tokens" integer,
	"third_pass_cost_usd" text,
	"third_pass_api_model_name" text,
	"third_pass_updated_at" text
);
--> statement-breakpoint
CREATE TABLE "project_manual_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"absorbed_key" text NOT NULL,
	"survivor_key" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "project_manual_merges_absorbed_key_unique" UNIQUE("absorbed_key")
);
--> statement-breakpoint
CREATE TABLE "telegram_review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hold_reason" text NOT NULL,
	"payload_json" text NOT NULL,
	"affiliation_id" text,
	"fingerprint_merge_id" text,
	"telegram_chat_id" text,
	"telegram_message_id" integer,
	"created_at" text NOT NULL,
	"reviewed_at" text,
	"reviewed_via" text
);
--> statement-breakpoint
CREATE TABLE "todo_highlight_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"model_id" text NOT NULL,
	"extraction_json" text NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" text,
	"api_model_name" text,
	"persist_source_id" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"title" text NOT NULL,
	"meeting_date" text NOT NULL,
	"pipeline_state" text DEFAULT 'created' NOT NULL,
	"current_step" text,
	"progress_percent" integer DEFAULT 0,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "meetings_v2_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_agenda_chunk_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"chunk_kind" text NOT NULL,
	"sort_order" integer NOT NULL,
	"no_change" boolean DEFAULT false NOT NULL,
	"before_state_json" text NOT NULL,
	"after_state_json" text NOT NULL,
	"request_json" text,
	"response_text" text,
	"parsed_json" text,
	"usage_json" text,
	"estimated_cost_usd" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_agenda_item_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"agenda_item_id" text NOT NULL,
	"context_json" text NOT NULL,
	"assembled_context_text" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_agenda_item_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"agenda_item_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"rationale" text,
	"relevance_score" integer NOT NULL,
	"snippet" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_agenda_item_investigations" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"agenda_item_id" text NOT NULL,
	"discussion_summary" text NOT NULL,
	"outcome" text NOT NULL,
	"confidence" text NOT NULL,
	"visibility" text NOT NULL,
	"decisions_json" text NOT NULL,
	"motion_json" text,
	"actions_json" text NOT NULL,
	"open_questions_json" text NOT NULL,
	"user_answers_json" text,
	"model_name" text,
	"usage_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_agenda_items" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"source_artifact_id" text,
	"source_section_id" text,
	"section_label" text,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"item_number" text,
	"item_type" text NOT NULL,
	"source_pages_json" text NOT NULL,
	"source_text" text,
	"sort_order" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"source_artifact_id" text NOT NULL,
	"chunk_key" text NOT NULL,
	"chunk_kind" text NOT NULL,
	"sort_order" integer NOT NULL,
	"page_start" integer,
	"page_end" integer,
	"sequence_start" integer,
	"sequence_end" integer,
	"start_timestamp" text,
	"end_timestamp" text,
	"text" text NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_document_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"source_artifact_id" text NOT NULL,
	"page_number" integer NOT NULL,
	"page_heading" text,
	"extracted_text" text NOT NULL,
	"image_path" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_document_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"source_artifact_id" text NOT NULL,
	"title" text NOT NULL,
	"start_page" integer NOT NULL,
	"end_page" integer NOT NULL,
	"summary" text,
	"sort_order" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_minutes_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"format" text NOT NULL,
	"title" text NOT NULL,
	"content_markdown" text NOT NULL,
	"summary_json" text,
	"model_name" text,
	"usage_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_source_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"type" text NOT NULL,
	"reference_classification" text,
	"original_filename" text NOT NULL,
	"mime_type" text,
	"storage_path" text NOT NULL,
	"checksum" text NOT NULL,
	"size_bytes" integer,
	"page_count" integer,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_transcript_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"source_artifact_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"start_timestamp" text NOT NULL,
	"end_timestamp" text NOT NULL,
	"speaker_label" text,
	"text" text NOT NULL,
	"raw_cue_id" text
);
--> statement-breakpoint
CREATE TABLE "meetings_v2_validation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"agenda_item_id" text NOT NULL,
	"validation_type" text NOT NULL,
	"severity" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"details_json" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "source_quote" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "status" text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "email_sync_settings" ADD COLUMN "harvest_after_sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "body_text_strict_unique" text;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN "kind" text DEFAULT 'equipment' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN "significance" text DEFAULT 'major' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN "manufacturer" text;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN "aliases_json" text;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN "canonical_id" text;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN "source" text DEFAULT 'extracted' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD COLUMN "registry_id" text;--> statement-breakpoint
ALTER TABLE "extracted_action_items" ADD COLUMN "related_event_id" text;--> statement-breakpoint
ALTER TABLE "extracted_action_items" ADD COLUMN "lifecycle_status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "global_todos" ADD COLUMN "source_kind" text DEFAULT 'meeting' NOT NULL;--> statement-breakpoint
ALTER TABLE "global_todos" ADD COLUMN "source_extracted_action_item_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "gold_standard_file_path" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "gold_standard_validation_json" text;--> statement-breakpoint
ALTER TABLE "attachment_document_pages" ADD CONSTRAINT "attachment_document_pages_content_hash_attachment_documents_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."attachment_documents"("content_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_email_index" ADD CONSTRAINT "contact_email_index_current_person_id_contact_persons_id_fk" FOREIGN KEY ("current_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_highlight_extractions" ADD CONSTRAINT "contact_highlight_extractions_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_mentions" ADD CONSTRAINT "contact_mentions_source_email_id_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_mentions" ADD CONSTRAINT "contact_mentions_fingerprint_merge_id_contact_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."contact_fingerprint_merges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_mentions" ADD CONSTRAINT "contact_mentions_resolved_person_id_contact_persons_id_fk" FOREIGN KEY ("resolved_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_mentions" ADD CONSTRAINT "contact_mentions_resolved_organization_id_organization_entities_id_fk" FOREIGN KEY ("resolved_organization_id") REFERENCES "public"."organization_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_proposals" ADD CONSTRAINT "contact_merge_proposals_target_person_id_contact_persons_id_fk" FOREIGN KEY ("target_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_proposals" ADD CONSTRAINT "contact_merge_proposals_result_person_id_contact_persons_id_fk" FOREIGN KEY ("result_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_proposals" ADD CONSTRAINT "contact_merge_proposals_fingerprint_merge_id_contact_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."contact_fingerprint_merges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_person_emails" ADD CONSTRAINT "contact_person_emails_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_person_field_denials" ADD CONSTRAINT "contact_person_field_denials_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_person_phones" ADD CONSTRAINT "contact_person_phones_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_person_titles" ADD CONSTRAINT "contact_person_titles_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_current_organization_id_organization_entities_id_fk" FOREIGN KEY ("current_organization_id") REFERENCES "public"."organization_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_registry_ingests" ADD CONSTRAINT "contact_registry_ingests_fingerprint_merge_id_contact_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."contact_fingerprint_merges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_highlight_extractions" ADD CONSTRAINT "event_highlight_extractions_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_highlight_extractions" ADD CONSTRAINT "organization_highlight_extractions_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_organization_affiliations" ADD CONSTRAINT "person_organization_affiliations_person_id_contact_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contact_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_organization_affiliations" ADD CONSTRAINT "person_organization_affiliations_organization_id_organization_entities_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_highlight_extractions" ADD CONSTRAINT "project_highlight_extractions_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_review_items" ADD CONSTRAINT "telegram_review_items_affiliation_id_person_organization_affiliations_id_fk" FOREIGN KEY ("affiliation_id") REFERENCES "public"."person_organization_affiliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_review_items" ADD CONSTRAINT "telegram_review_items_fingerprint_merge_id_contact_fingerprint_merges_id_fk" FOREIGN KEY ("fingerprint_merge_id") REFERENCES "public"."contact_fingerprint_merges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_highlight_extractions" ADD CONSTRAINT "todo_highlight_extractions_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_chunk_snapshots" ADD CONSTRAINT "meetings_v2_agenda_chunk_snapshots_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_chunk_snapshots" ADD CONSTRAINT "meetings_v2_agenda_chunk_snapshots_chunk_id_meetings_v2_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."meetings_v2_document_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_item_contexts" ADD CONSTRAINT "meetings_v2_agenda_item_contexts_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_item_contexts" ADD CONSTRAINT "meetings_v2_agenda_item_contexts_agenda_item_id_meetings_v2_agenda_items_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."meetings_v2_agenda_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_item_evidence" ADD CONSTRAINT "meetings_v2_agenda_item_evidence_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_item_evidence" ADD CONSTRAINT "meetings_v2_agenda_item_evidence_agenda_item_id_meetings_v2_agenda_items_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."meetings_v2_agenda_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_item_investigations" ADD CONSTRAINT "meetings_v2_agenda_item_investigations_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_item_investigations" ADD CONSTRAINT "meetings_v2_agenda_item_investigations_agenda_item_id_meetings_v2_agenda_items_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."meetings_v2_agenda_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_items" ADD CONSTRAINT "meetings_v2_agenda_items_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_items" ADD CONSTRAINT "meetings_v2_agenda_items_source_artifact_id_meetings_v2_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."meetings_v2_source_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_agenda_items" ADD CONSTRAINT "meetings_v2_agenda_items_source_section_id_meetings_v2_document_sections_id_fk" FOREIGN KEY ("source_section_id") REFERENCES "public"."meetings_v2_document_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_document_chunks" ADD CONSTRAINT "meetings_v2_document_chunks_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_document_chunks" ADD CONSTRAINT "meetings_v2_document_chunks_source_artifact_id_meetings_v2_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."meetings_v2_source_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_document_pages" ADD CONSTRAINT "meetings_v2_document_pages_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_document_pages" ADD CONSTRAINT "meetings_v2_document_pages_source_artifact_id_meetings_v2_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."meetings_v2_source_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_document_sections" ADD CONSTRAINT "meetings_v2_document_sections_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_document_sections" ADD CONSTRAINT "meetings_v2_document_sections_source_artifact_id_meetings_v2_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."meetings_v2_source_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_minutes_drafts" ADD CONSTRAINT "meetings_v2_minutes_drafts_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_source_artifacts" ADD CONSTRAINT "meetings_v2_source_artifacts_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_transcript_segments" ADD CONSTRAINT "meetings_v2_transcript_segments_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_transcript_segments" ADD CONSTRAINT "meetings_v2_transcript_segments_source_artifact_id_meetings_v2_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."meetings_v2_source_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_validation_results" ADD CONSTRAINT "meetings_v2_validation_results_meeting_v2_id_meetings_v2_id_fk" FOREIGN KEY ("meeting_v2_id") REFERENCES "public"."meetings_v2"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings_v2_validation_results" ADD CONSTRAINT "meetings_v2_validation_results_agenda_item_id_meetings_v2_agenda_items_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."meetings_v2_agenda_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_document_pages_hash_page_unique" ON "attachment_document_pages" USING btree ("content_hash","page_no");--> statement-breakpoint
CREATE INDEX "attachment_document_pages_route_idx" ON "attachment_document_pages" USING btree ("route");--> statement-breakpoint
CREATE INDEX "attachment_document_pages_vision_status_idx" ON "attachment_document_pages" USING btree ("vision_status");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_mentions_email_fingerprint_unique" ON "contact_mentions" USING btree ("source_email_id","fingerprint");--> statement-breakpoint
CREATE INDEX "contact_mentions_status_idx" ON "contact_mentions" USING btree ("resolution_status");--> statement-breakpoint
CREATE INDEX "contact_mentions_first_name_key_idx" ON "contact_mentions" USING btree ("first_name_key");--> statement-breakpoint
CREATE INDEX "contact_mentions_first_org_key_idx" ON "contact_mentions" USING btree ("first_org_key");--> statement-breakpoint
CREATE INDEX "contact_mentions_resolved_person_idx" ON "contact_mentions" USING btree ("resolved_person_id");--> statement-breakpoint
CREATE INDEX "contact_mentions_email_idx" ON "contact_mentions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_person_field_denials_person_field_value_unique" ON "contact_person_field_denials" USING btree ("person_id","field","denied_value");--> statement-breakpoint
CREATE UNIQUE INDEX "event_highlight_extractions_email_model_unique" ON "event_highlight_extractions" USING btree ("email_id","model_id");--> statement-breakpoint
CREATE INDEX "organization_entities_status_idx" ON "organization_entities" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_field_attachments_org_field_value_unique" ON "organization_field_attachments" USING btree ("org_key","field","value_key");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_field_denials_org_field_value_unique" ON "organization_field_denials" USING btree ("org_key","field","denied_value");--> statement-breakpoint
CREATE UNIQUE INDEX "person_org_affiliations_person_org_unique" ON "person_organization_affiliations" USING btree ("person_id","organization_id");--> statement-breakpoint
CREATE INDEX "person_org_affiliations_person_status_idx" ON "person_organization_affiliations" USING btree ("person_id","status");--> statement-breakpoint
CREATE INDEX "person_org_affiliations_org_status_idx" ON "person_organization_affiliations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "project_entities_status_idx" ON "project_entities" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_field_denials_project_field_value_unique" ON "project_field_denials" USING btree ("project_key","field","denied_value");--> statement-breakpoint
CREATE UNIQUE INDEX "project_fingerprint_merges_model_emails_unique" ON "project_fingerprint_merges" USING btree ("model_id","email_ids_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_highlight_extractions_email_model_unique" ON "project_highlight_extractions" USING btree ("email_id","model_id");--> statement-breakpoint
CREATE INDEX "telegram_review_items_pending_created_idx" ON "telegram_review_items" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_review_items_affiliation_unique" ON "telegram_review_items" USING btree ("affiliation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "todo_highlight_extractions_email_model_unique" ON "todo_highlight_extractions" USING btree ("email_id","model_id");--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_canonical_id_equipment_assets_id_fk" FOREIGN KEY ("canonical_id") REFERENCES "public"."equipment_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_assets" ADD CONSTRAINT "equipment_assets_registry_id_building_equipment_registry_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."building_equipment_registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_todos" ADD CONSTRAINT "global_todos_source_extracted_action_item_id_extracted_action_items_id_fk" FOREIGN KEY ("source_extracted_action_item_id") REFERENCES "public"."extracted_action_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "global_todos_source_extracted_action_item_unique" ON "global_todos" USING btree ("source_extracted_action_item_id");