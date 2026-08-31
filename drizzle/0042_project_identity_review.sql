CREATE TABLE IF NOT EXISTS "project_identity_review_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"status" text NOT NULL,
	"current_pass" integer,
	"cluster_total" integer DEFAULT 0 NOT NULL,
	"cluster_completed" integer DEFAULT 0 NOT NULL,
	"project_count" integer DEFAULT 0 NOT NULL,
	"high_applied" integer DEFAULT 0 NOT NULL,
	"proposed_count" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" text,
	"last_error" text,
	"started_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_identity_review_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"label" text NOT NULL,
	"member_ids_json" text NOT NULL,
	"sort_index" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_identity_review_clusters" ADD CONSTRAINT "project_identity_review_clusters_run_id_project_identity_review_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."project_identity_review_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_identity_review_clusters_run_idx" ON "project_identity_review_clusters" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_identity_review_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"cluster_id" text NOT NULL,
	"kind" text NOT NULL,
	"confidence" text NOT NULL,
	"rationale" text NOT NULL,
	"work_label" text,
	"decision_json" text NOT NULL,
	"status" text NOT NULL,
	"applied_at" text,
	"error" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_identity_review_decisions" ADD CONSTRAINT "project_identity_review_decisions_run_id_project_identity_review_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."project_identity_review_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_identity_review_decisions" ADD CONSTRAINT "project_identity_review_decisions_cluster_id_project_identity_review_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."project_identity_review_clusters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_identity_review_decisions_run_idx" ON "project_identity_review_decisions" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_identity_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"survivor_key" text NOT NULL,
	"work_label" text NOT NULL,
	"policy" text NOT NULL,
	"aliases_json" text DEFAULT '[]' NOT NULL,
	"year_hint" text,
	"review_run_id" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_identity_policies_survivor_key_unique" ON "project_identity_policies" ("survivor_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_identity_policies_work_label_idx" ON "project_identity_policies" ("work_label");
