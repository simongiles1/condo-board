/**
 * Wipes ALL data derived from AI processing so the user can start fresh:
 *  - meetings, global todos, meeting upload files
 *  - extraction_sources and linked insight rows
 *  - extraction skill entries/versions/audit log
 *  - emails.processed_at → NULL so the analyzer re-runs each email
 *  - email_attachments processed/hash/cache fields reset
 *  - analysis_queue rows
 *
 * Leaves Gmail connections, sync runs, emails, attachments, sender allowlist,
 * and dev notes untouched.
 *
 * Usage:  node scripts/purge-analysis-data.mjs
 */
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_URL?.startsWith("file:")
  ? process.env.DATABASE_URL.slice("file:".length)
  : process.env.DATABASE_URL ?? "./data/app.db";

const db = new Database(dbPath);

const countTable = (name) =>
  db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c;

const before = {
  meetings: countTable("meetings"),
  global_todos: countTable("global_todos"),
  extraction_sources: countTable("extraction_sources"),
  calendar_events: countTable("calendar_events"),
  discovered_facts: countTable("discovered_facts"),
  analysis_queue: countTable("analysis_queue"),
  emails_processed: db
    .prepare("SELECT COUNT(*) AS c FROM emails WHERE processed_at IS NOT NULL")
    .get().c,
};

console.log("Before:", before);

const cleanup = db.transaction(() => {
  const stats = {};
  const tables = [
    "calendar_events",
    "maintenance_events",
    "budget_line_items",
    "invoices",
    "contracts",
    "resident_issues",
    "capital_projects",
    "entity_mentions",
    "extracted_action_items",
    "discovered_facts",
    "extraction_sources",
    "extraction_skill_audit_log",
    "extraction_skill_entries",
    "extraction_skill_versions",
    "global_todos",
    "meetings",
    "equipment_assets",
    "vendors",
    "budget_categories",
    "analysis_queue",
  ];

  for (const table of tables) {
    stats[table] = db.prepare(`DELETE FROM ${table}`).run().changes;
  }

  stats.emails_reset = db
    .prepare("UPDATE emails SET processed_at = NULL WHERE processed_at IS NOT NULL")
    .run().changes;
  stats.attachments_reset = db
    .prepare(
      "UPDATE email_attachments SET processed_at = NULL, content_hash = NULL, cached_file_path = NULL WHERE processed_at IS NOT NULL OR content_hash IS NOT NULL OR cached_file_path IS NOT NULL",
    )
    .run().changes;
  return stats;
});

const result = cleanup();

console.log("Removed:", result);
console.log("After:", {
  meetings: countTable("meetings"),
  extraction_sources: countTable("extraction_sources"),
  calendar_events: countTable("calendar_events"),
  emails_processed: db
    .prepare("SELECT COUNT(*) AS c FROM emails WHERE processed_at IS NOT NULL")
    .get().c,
});
