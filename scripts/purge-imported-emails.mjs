import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://condo:condo@localhost:5432/condo_board";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const client = await pool.connect();

try {
  const before = {
    emails: (await client.query("SELECT COUNT(*)::int AS c FROM emails")).rows[0]
      .c,
    threads: (await client.query("SELECT COUNT(*)::int AS c FROM email_threads"))
      .rows[0].c,
    syncRuns: (await client.query("SELECT COUNT(*)::int AS c FROM sync_runs"))
      .rows[0].c,
  };

  console.log("Before:", before);

  await client.query("BEGIN");

  const deletedEmails = (
    await client.query("DELETE FROM emails")
  ).rowCount;
  const deletedThreads = (
    await client.query("DELETE FROM email_threads")
  ).rowCount;
  const deletedSyncRuns = (
    await client.query("DELETE FROM sync_runs")
  ).rowCount;
  const deletedConnections = (
    await client.query("DELETE FROM gmail_connections")
  ).rowCount;

  await client.query("COMMIT");

  console.log("Removed:", {
    deletedEmails,
    deletedThreads,
    deletedSyncRuns,
    deletedConnections,
  });
  console.log("After:", {
    emails: (await client.query("SELECT COUNT(*)::int AS c FROM emails")).rows[0]
      .c,
    threads: (await client.query("SELECT COUNT(*)::int AS c FROM email_threads"))
      .rows[0].c,
    syncRuns: (await client.query("SELECT COUNT(*)::int AS c FROM sync_runs"))
      .rows[0].c,
    connections: (
      await client.query(
        "SELECT account_type, email_address, last_history_id FROM gmail_connections",
      )
    ).rows,
  });
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
