CREATE INDEX IF NOT EXISTS "document_chunks_email_body_idx" ON "document_chunks" ("email_id") WHERE "source_kind" = 'email_body';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_attachment_md_idx" ON "document_chunks" ("content_hash") WHERE "source_kind" = 'attachment_markdown';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_vision_page_idx" ON "document_chunks" ("content_hash", "page_no") WHERE "source_kind" = 'attachment_vision_page';
