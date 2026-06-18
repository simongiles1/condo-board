CREATE TABLE "action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"assignee" text NOT NULL,
	"role" text NOT NULL,
	"description" text NOT NULL,
	"deadline" text,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "analysis_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_type" text NOT NULL,
	"unit_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" text NOT NULL,
	"started_at" text,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "analysis_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"analysis_model" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"merge_model" text,
	"max_output_tokens" integer DEFAULT 65536 NOT NULL,
	"extraction_version" integer DEFAULT 1 NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "app_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "budget_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" text
);
--> statement-breakpoint
CREATE TABLE "budget_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text,
	"category_name" text NOT NULL,
	"subcategory" text,
	"fiscal_year" integer,
	"period_start" text,
	"period_end" text,
	"budgeted_amount" text,
	"actual_amount" text,
	"variance" text,
	"currency" text DEFAULT 'CAD',
	"source_quote" text,
	"confidence" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"event_type" text NOT NULL,
	"start_at" text NOT NULL,
	"end_at" text,
	"description" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capital_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phase" text,
	"status" text,
	"budget" text,
	"contractor" text,
	"start_date" text,
	"completion_date" text,
	"source_quote" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text,
	"vendor_name" text,
	"contract_type" text,
	"start_date" text,
	"end_date" text,
	"value" text,
	"source_quote" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dev_note_screenshots" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dev_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovered_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"concept_id" text NOT NULL,
	"payload_json" text NOT NULL,
	"source_quote" text,
	"confidence" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"gmail_attachment_id" text,
	"content_hash" text,
	"cached_file_path" text,
	"processed_at" text,
	"has_value" boolean
);
--> statement-breakpoint
CREATE TABLE "email_forward_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processed_at" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "email_forward_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"target_email" text NOT NULL,
	"source_query" text NOT NULL,
	"total_queued" integer DEFAULT 0 NOT NULL,
	"threads_matched" integer,
	"forwarded_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"chunk_size" integer DEFAULT 50 NOT NULL,
	"chunk_delay_ms" integer DEFAULT 120000 NOT NULL,
	"next_chunk_at" text,
	"started_at" text NOT NULL,
	"finished_at" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "email_sync_exclusions" (
	"gmail_message_id" text PRIMARY KEY NOT NULL,
	"message_id_header" text,
	"excluded_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_sync_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"sync_cron" text DEFAULT '0 7 * * *' NOT NULL,
	"scheduler_enabled" boolean DEFAULT true NOT NULL,
	"backfill_cutoff_date" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"subject" text NOT NULL,
	"last_message_at" text NOT NULL,
	CONSTRAINT "email_threads_gmail_thread_id_unique" UNIQUE("gmail_thread_id")
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text,
	"gmail_message_id" text NOT NULL,
	"message_id_header" text,
	"in_reply_to" text,
	"references_header" text,
	"from_address" text NOT NULL,
	"to_addresses" text NOT NULL,
	"cc_addresses" text DEFAULT '[]' NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"body_text_unique" text,
	"received_at" text NOT NULL,
	"source" text NOT NULL,
	"sync_run_id" text,
	"processed_at" text,
	CONSTRAINT "emails_gmail_message_id_unique" UNIQUE("gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "entity_exclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_value" text NOT NULL,
	"dedup_key" text NOT NULL,
	"note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_value" text NOT NULL,
	"context" text,
	"contact_email" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"organization_role" text,
	"vendor_candidate" boolean DEFAULT false NOT NULL,
	"dedup_key" text,
	"person_title" text,
	"linked_organization_name" text,
	"source_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"category" text,
	"install_date" text,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extracted_action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"assignee" text NOT NULL,
	"description" text NOT NULL,
	"deadline" text,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" text,
	"meeting_id" text,
	"email_thread_id" text,
	"source_quote" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_skill_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text,
	"action" text NOT NULL,
	"details_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_skill_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"concept_name" text NOT NULL,
	"description" text NOT NULL,
	"suggested_fields_json" text DEFAULT '[]' NOT NULL,
	"example_quotes_json" text DEFAULT '[]' NOT NULL,
	"example_email_ids_json" text DEFAULT '[]' NOT NULL,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" text,
	"category" text,
	"user_notes" text,
	"routing_destination_id" text,
	"field_mapping_json" text DEFAULT '{}' NOT NULL,
	"routing_options_json" text DEFAULT '{}' NOT NULL,
	"routing_configured_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "extraction_skill_entries_concept_name_unique" UNIQUE("concept_name")
);
--> statement-breakpoint
CREATE TABLE "extraction_skill_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "extraction_skill_versions_version_number_unique" UNIQUE("version_number")
);
--> statement-breakpoint
CREATE TABLE "extraction_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"email_thread_id" text,
	"processed_at" text NOT NULL,
	"model_name" text NOT NULL,
	"extraction_version" integer DEFAULT 1 NOT NULL,
	"skill_version_id" text,
	"content_hash" text,
	"raw_extraction_json" text NOT NULL,
	"ai_usage_json" text,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" text DEFAULT '0' NOT NULL,
	"processing_duration_ms" integer,
	"triggered_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "global_todos" (
	"id" text PRIMARY KEY NOT NULL,
	"assignee" text NOT NULL,
	"role" text NOT NULL,
	"description" text NOT NULL,
	"deadline" text,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" text,
	"source_meeting_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"account_type" text NOT NULL,
	"email_address" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"token_expiry" text,
	"last_history_id" text,
	"last_sync_at" text,
	"connected_at" text NOT NULL,
	CONSTRAINT "gmail_connections_account_type_unique" UNIQUE("account_type")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text,
	"vendor_name" text,
	"amount" text NOT NULL,
	"invoice_date" text,
	"invoice_number" text,
	"category_name" text,
	"paid" boolean,
	"source_quote" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_events" (
	"id" text PRIMARY KEY NOT NULL,
	"equipment_id" text,
	"equipment_name" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" text,
	"occurred_time" text,
	"vendor_id" text,
	"vendor_name" text,
	"cost" text,
	"work_order" text,
	"status" text,
	"description" text,
	"source_quote" text,
	"confidence" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_date" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"minutes_content" text NOT NULL,
	"minutes_json" text,
	"omissions_analysis_json" text,
	"ai_usage_json" text,
	"todos_content" text NOT NULL,
	"global_todos_merged_at" text,
	"vtt_file_path" text NOT NULL,
	"pdf_file_path" text NOT NULL,
	"board_package_file_path" text,
	"created_at" text NOT NULL,
	"finalized_at" text
);
--> statement-breakpoint
CREATE TABLE "organization_role_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "organization_role_definitions_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "personal_forwarded_messages" (
	"gmail_message_id" text PRIMARY KEY NOT NULL,
	"gmail_thread_id" text,
	"forward_run_id" text,
	"forward_message_id_header" text,
	"forwarded_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resident_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"unit" text,
	"category" text,
	"description" text NOT NULL,
	"status" text,
	"resolution" text,
	"opened_at" text,
	"resolved_at" text,
	"source_quote" text,
	"source_id" text NOT NULL,
	"dedup_key" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_allowlist" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"notes" text,
	"added_at" text NOT NULL,
	CONSTRAINT "sender_allowlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_type" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"messages_added" integer DEFAULT 0 NOT NULL,
	"messages_skipped" integer DEFAULT 0 NOT NULL,
	"errors" text
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_json" text,
	"services_json" text,
	"review_status" text DEFAULT 'approved' NOT NULL,
	"organization_role" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_projects" ADD CONSTRAINT "capital_projects_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_note_screenshots" ADD CONSTRAINT "dev_note_screenshots_note_id_dev_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."dev_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_facts" ADD CONSTRAINT "discovered_facts_concept_id_extraction_skill_entries_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."extraction_skill_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_facts" ADD CONSTRAINT "discovered_facts_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_forward_queue" ADD CONSTRAINT "email_forward_queue_run_id_email_forward_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."email_forward_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_action_items" ADD CONSTRAINT "extracted_action_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_action_items" ADD CONSTRAINT "extracted_action_items_email_thread_id_email_threads_id_fk" FOREIGN KEY ("email_thread_id") REFERENCES "public"."email_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_action_items" ADD CONSTRAINT "extracted_action_items_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_skill_audit_log" ADD CONSTRAINT "extraction_skill_audit_log_entry_id_extraction_skill_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."extraction_skill_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_sources" ADD CONSTRAINT "extraction_sources_email_thread_id_email_threads_id_fk" FOREIGN KEY ("email_thread_id") REFERENCES "public"."email_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_sources" ADD CONSTRAINT "extraction_sources_skill_version_id_extraction_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."extraction_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_sources" ADD CONSTRAINT "extraction_sources_triggered_by_user_id_app_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_todos" ADD CONSTRAINT "global_todos_source_meeting_id_meetings_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_equipment_id_equipment_assets_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_forwarded_messages" ADD CONSTRAINT "personal_forwarded_messages_forward_run_id_email_forward_runs_id_fk" FOREIGN KEY ("forward_run_id") REFERENCES "public"."email_forward_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_issues" ADD CONSTRAINT "resident_issues_source_id_extraction_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."extraction_sources"("id") ON DELETE cascade ON UPDATE no action;