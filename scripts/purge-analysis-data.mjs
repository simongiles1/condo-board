/**
 * Wipes ALL data derived from AI processing so the user can start fresh.
 *
 * Usage:  node scripts/purge-analysis-data.mjs
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Set DATABASE_URL to a Postgres connection string.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const countTable = async (client, name) => {
  const result = await client.query(`SELECT COUNT(*)::int AS c FROM ${name}`);
  return result.rows[0].c;
};

const client = await pool.connect();

try {
  const before = {
    meetings: await countTable(client, "meetings"),
    global_todos: await countTable(client, "global_todos"),
    extraction_sources: await countTable(client, "extraction_sources"),
    calendar_events: await countTable(client, "calendar_events"),
    discovered_facts: await countTable(client, "discovered_facts"),
    analysis_queue: await countTable(client, "analysis_queue"),
    emails_processed: (
      await client.query(
        "SELECT COUNT(*)::int AS c FROM emails WHERE processed_at IS NOT NULL",
      )
    ).rows[0].c,
  };

  console.log("Before:", before);

  await client.query("BEGIN");

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
    const result = await client.query(`DELETE FROM ${table}`);
    stats[table] = result.rowCount ?? 0;
  }

  stats.emails_reset = (
    await client.query(
      "UPDATE emails SET processed_at = NULL WHERE processed_at IS NOT NULL",
    )
  ).rowCount;
  stats.attachments_reset = (
    await client.query(
      "UPDATE email_attachments SET processed_at = NULL, content_hash = NULL, cached_file_path = NULL WHERE processed_at IS NOT NULL OR content_hash IS NOT NULL OR cached_file_path IS NOT NULL",
    )
  ).rowCount;

  await client.query("COMMIT");

  console.log("Removed:", stats);
  console.log("After:", {
    meetings: await countTable(client, "meetings"),
    extraction_sources: await countTable(client, "extraction_sources"),
    calendar_events: await countTable(client, "calendar_events"),
    emails_processed: (
      await client.query(
        "SELECT COUNT(*)::int AS c FROM emails WHERE processed_at IS NOT NULL",
      )
    ).rows[0].c,
  });
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
