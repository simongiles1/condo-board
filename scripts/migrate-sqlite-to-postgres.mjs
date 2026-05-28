/**
 * One-time migration from local SQLite to Postgres.
 *
 * Prerequisites:
 *   1. Postgres running and DATABASE_URL set (see .env.local.example)
 *   2. Schema applied: npm run db:push
 *   3. SQLite file at SQLITE_DATABASE_PATH or ./data/app.db
 *
 * Usage:
 *   npm run db:migrate-from-sqlite
 */
import Database from "better-sqlite3";
import pg from "pg";

const SQLITE_PATH =
  process.env.SQLITE_DATABASE_PATH ??
  (process.env.DATABASE_URL?.startsWith("file:")
    ? process.env.DATABASE_URL.slice("file:".length)
    : "./data/app.db");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.startsWith("file:")) {
  console.error("Set DATABASE_URL to a Postgres connection string.");
  process.exit(1);
}

/** Tables in an order safe for FK inserts when replication role is default. */
const TABLES = [
  "meetings",
  "app_users",
  "sender_allowlist",
  "email_sync_settings",
  "gmail_connections",
  "sync_runs",
  "email_threads",
  "dev_notes",
  "extraction_skill_entries",
  "extraction_skill_versions",
  "equipment_assets",
  "vendors",
  "budget_categories",
  "analysis_settings",
  "analysis_queue",
  "email_sync_exclusions",
  "action_items",
  "global_todos",
  "emails",
  "email_attachments",
  "dev_note_screenshots",
  "extraction_skill_audit_log",
  "extraction_sources",
  "discovered_facts",
  "maintenance_events",
  "budget_line_items",
  "invoices",
  "contracts",
  "resident_issues",
  "capital_projects",
  "extracted_action_items",
  "entity_mentions",
  "calendar_events",
];

const BOOLEAN_COLUMNS = new Set([
  "completed",
  "scheduler_enabled",
  "paid",
]);

function normalizeValue(column, value) {
  if (value === null || value === undefined) return null;
  if (BOOLEAN_COLUMNS.has(column)) {
    if (typeof value === "boolean") return value;
    return value === 1 || value === "1" || value === true;
  }
  return value;
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function migrateTable(client, table) {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (!rows.length) {
    console.log(`  ${table}: 0 rows (skip)`);
    return 0;
  }

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

  let inserted = 0;
  for (const row of rows) {
    const values = columns.map((column) => normalizeValue(column, row[column]));
    const result = await client.query(sql, values);
    inserted += result.rowCount ?? 0;
  }

  console.log(`  ${table}: ${inserted}/${rows.length} rows`);
  return inserted;
}

async function main() {
  console.log(`SQLite source: ${SQLITE_PATH}`);
  console.log(`Postgres target: ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET session_replication_role = replica");

    let total = 0;
    for (const table of TABLES) {
      total += await migrateTable(client, table);
    }

    await client.query("SET session_replication_role = DEFAULT");
    await client.query("COMMIT");
    console.log(`Done. ${total} row(s) inserted.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
