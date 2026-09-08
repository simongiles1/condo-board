CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"email_id" text,
	"content_hash" text,
	"page_no" integer,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"char_start" integer,
	"char_end" integer,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"content_hash_dedup" text NOT NULL,
	"embedding" vector(768),
	"embed_model" text DEFAULT 'gemini-embedding-001' NOT NULL,
	"indexed_at" text NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_source_kind_idx" ON "document_chunks" ("source_kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_email_id_idx" ON "document_chunks" ("email_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_content_hash_idx" ON "document_chunks" ("content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_content_hash_dedup_idx" ON "document_chunks" ("content_hash_dedup");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
