CREATE TABLE IF NOT EXISTS "attachment_document_pages" (
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
  "profiler_version" text NOT NULL,
  "profiled_at" text NOT NULL,
  CONSTRAINT "attachment_document_pages_content_hash_fk"
    FOREIGN KEY ("content_hash") REFERENCES "attachment_documents"("content_hash")
    ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attachment_document_pages_hash_page_unique"
  ON "attachment_document_pages" ("content_hash", "page_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_document_pages_route_idx"
  ON "attachment_document_pages" ("route");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_document_pages_vision_status_idx"
  ON "attachment_document_pages" ("vision_status");
