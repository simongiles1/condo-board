/**
 * Single schema application path for local dev and Docker.
 *
 * Workflow after editing lib/db/schema.ts:
 *   npm run db:generate   # create drizzle/000N_*.sql
 *   npm run db:migrate    # apply pending migrations
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const { migrate } = require("drizzle-orm/node-postgres/migrator");

const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const LEGACY_MIGRATIONS_TABLE = "__condo_board_migrations";

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

function getConnectionString() {
  const connectionString =
    process.env.COND_BOARD_POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL (or COND_BOARD_POSTGRES_URL) is required for db:migrate.",
    );
  }
  if (connectionString.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL points at SQLite. Use Postgres and run npm run db:migrate.",
    );
  }
  return connectionString;
}

function logConnectionTarget() {
  try {
    const { hostname, port, pathname } = new URL(getConnectionString());
    console.log(`[db:migrate] Postgres ${hostname}:${port}${pathname}`);
  } catch {
    console.log("[db:migrate] Using configured Postgres connection string.");
  }
}

async function tableExists(client, tableName, schemaName = "public") {
  const { rows } = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`${schemaName}.${tableName}`],
  );
  return Boolean(rows[0]?.exists);
}

function loadJournal() {
  const journalPath = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Missing Drizzle journal at ${journalPath}`);
  }
  return JSON.parse(fs.readFileSync(journalPath, "utf8"));
}

function getMigrationHash(tag) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function bootstrapMigrationTracking(client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const { rows } = await client.query(`
    SELECT created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (rows.length > 0) return;

  const journal = loadJournal();
  let appliedTags = [];

  if (await tableExists(client, LEGACY_MIGRATIONS_TABLE)) {
    const { rows: legacyRows } = await client.query(
      `SELECT id FROM ${LEGACY_MIGRATIONS_TABLE}`,
    );
    appliedTags = legacyRows.map((row) => row.id);
  } else if (await tableExists(client, "meetings")) {
    appliedTags = journal.entries.length > 0 ? [journal.entries[0].tag] : [];
  } else {
    return;
  }

  let latestEntry = null;
  for (const entry of journal.entries) {
    if (!appliedTags.includes(entry.tag)) continue;
    if (!latestEntry || entry.when > latestEntry.when) {
      latestEntry = entry;
    }
  }

  if (!latestEntry) return;

  await client.query(
    `
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES ($1, $2)
    `,
    [getMigrationHash(latestEntry.tag), latestEntry.when],
  );
  console.log(
    `[db:migrate] Bootstrapped through ${latestEntry.tag} from existing database.`,
  );
}

async function main() {
  logConnectionTarget();

  const pool = new Pool({
    connectionString: getConnectionString(),
    connectionTimeoutMillis: 5000,
  });

  const bootstrapClient = await pool.connect();
  try {
    await bootstrapClient.query("SELECT 1");
    await bootstrapMigrationTracking(bootstrapClient);
  } finally {
    bootstrapClient.release();
  }

  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  await pool.end();

  console.log("[db:migrate] Database migrations complete.");
}

main().catch((error) => {
  console.error("[db:migrate] Failed:", error);
  process.exit(1);
});
