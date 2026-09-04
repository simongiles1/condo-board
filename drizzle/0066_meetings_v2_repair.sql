CREATE TABLE IF NOT EXISTS "meetings_v2" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"title" text NOT NULL,
	"meeting_date" text NOT NULL,
	"pipeline_state" text DEFAULT 'created' NOT NULL,
	"current_step" text,
	"progress_percent" integer DEFAULT 0,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meetings_v2_source_key_unique" ON "meetings_v2" USING btree ("source_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meetings_v2_source_artifacts" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_transcript_segments" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_document_pages" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_document_sections" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_document_chunks" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_agenda_chunk_snapshots" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_agenda_items" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_agenda_item_evidence" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_agenda_item_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_v2_id" text NOT NULL,
	"agenda_item_id" text NOT NULL,
	"context_json" text NOT NULL,
	"assembled_context_text" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meetings_v2_agenda_item_investigations" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_validation_results" (
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
CREATE TABLE IF NOT EXISTS "meetings_v2_minutes_drafts" (
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
