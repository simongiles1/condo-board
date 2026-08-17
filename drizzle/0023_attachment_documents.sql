CREATE TABLE IF NOT EXISTS "attachment_documents" (
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
CREATE INDEX IF NOT EXISTS "idx_attachment_documents_parse_status"
  ON "attachment_documents" ("parse_status");
