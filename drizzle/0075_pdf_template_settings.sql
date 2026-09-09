CREATE TABLE "pdf_template_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"top" integer DEFAULT 72 NOT NULL,
	"bottom" integer DEFAULT 72 NOT NULL,
	"left" integer DEFAULT 72 NOT NULL,
	"right" integer DEFAULT 72 NOT NULL,
	"page_one_rule_top" integer DEFAULT 94 NOT NULL,
	"header_rule_top" integer DEFAULT 71 NOT NULL,
	"updated_at" text NOT NULL
);
