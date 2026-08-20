/**
 * Single schema application path for local dev and Docker.
 * Uses pg only so it runs inside the Next.js standalone image.
 *
 * Workflow after editing lib/db/schema.ts:
 *   npm run db:generate   # create drizzle/000N_*.sql
 *   npm run db:migrate    # apply pending migrations
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

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

function postgresPoolOptions(connectionString) {
  const isSupabase =
    /supabase\.(co|com)|pooler\.supabase\.com/i.test(connectionString);
  if (!(isSupabase && process.platform === "win32")) {
    return { connectionString };
  }
  let stripped = connectionString;
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete("sslmode");
    stripped = parsed.toString();
  } catch {
    stripped = connectionString.replace(/[?&]sslmode=[^&]+/gi, "");
  }
  return {
    connectionString: stripped,
    ssl: { rejectUnauthorized: false },
  };
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

function loadMigrationFiles() {
  const journal = loadJournal();
  return journal.entries.map((entry) => {
    const filePath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing migration file: ${filePath}`);
    }

    const sql = fs.readFileSync(filePath, "utf8");
    return {
      tag: entry.tag,
      folderMillis: entry.when,
      hash: crypto.createHash("sha256").update(sql).digest("hex"),
      statements: sql
        .split(/--> statement-breakpoint\n?/)
        .map((statement) => statement.trim())
        .filter(Boolean),
    };
  });
}

async function ensureMigrationTable(client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

function isAlreadyPresentError(error) {
  const code = error?.code;
  return code === "42P07" || code === "42710" || code === "42701";
}

async function getLastAppliedMigration(client) {
  const { rows } = await client.query(`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function bootstrapMigrationTracking(client) {
  await ensureMigrationTable(client);

  const lastApplied = await getLastAppliedMigration(client);
  if (lastApplied) return;

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

  const migration = loadMigrationFiles().find(
    (item) => item.tag === latestEntry.tag,
  );
  if (!migration) {
    throw new Error(`Missing migration metadata for ${latestEntry.tag}`);
  }

  await client.query(
    `
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES ($1, $2)
    `,
    [migration.hash, migration.folderMillis],
  );
  console.log(
    `[db:migrate] Bootstrapped through ${latestEntry.tag} from existing database.`,
  );
}

async function applyPendingMigrations(client) {
  await ensureMigrationTable(client);

  const lastApplied = await getLastAppliedMigration(client);
  const lastAppliedAt = lastApplied ? Number(lastApplied.created_at) : null;
  const migrations = loadMigrationFiles();

  for (const migration of migrations) {
    if (lastAppliedAt !== null && lastAppliedAt >= migration.folderMillis) {
      console.log(`[db:migrate] ${migration.tag} already applied, skipping.`);
      continue;
    }

    console.log(
      `[db:migrate] Applying ${migration.tag} (${migration.statements.length} statements)...`,
    );

    await client.query("BEGIN");
    try {
      for (const statement of migration.statements) {
        await client.query(statement);
      }

      await client.query(
        `
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES ($1, $2)
        `,
        [migration.hash, migration.folderMillis],
      );
      await client.query("COMMIT");
      console.log(`[db:migrate] Applied ${migration.tag}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      // Dump restores already have objects that early CREATE TABLE migrations
      // lack IF NOT EXISTS. Stamp and continue so later journal rows still run.
      if (isAlreadyPresentError(error)) {
        await client.query(
          `
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES ($1, $2)
          `,
          [migration.hash, migration.folderMillis],
        );
        console.warn(
          `[db:migrate] ${migration.tag} already present in schema, stamped and skipped.`,
        );
        continue;
      }
      throw error;
    }
  }
}

const ANALYSIS_SCHEMA_CHECKS = [
  { table: "extraction_skill_entries", column: "routing_destination_id" },
  { table: "extraction_skill_entries", column: "status" },
  { table: "entity_mentions", column: "review_status" },
  { table: "entity_mentions", column: "vendor_candidate" },
  { table: "entity_exclusions", column: "dedup_key" },
];

async function columnExists(client, tableName, columnName, schemaName = "public") {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
      LIMIT 1
    `,
    [schemaName, tableName, columnName],
  );
  return rows.length > 0;
}

async function verifyAnalysisSchema(client) {
  for (const check of ANALYSIS_SCHEMA_CHECKS) {
    const tablePresent = await tableExists(client, check.table);
    if (!tablePresent) {
      console.warn(`[db:migrate] WARN: missing table public.${check.table}`);
      continue;
    }

    if (!(await columnExists(client, check.table, check.column))) {
      console.warn(
        `[db:migrate] WARN: missing column public.${check.table}.${check.column}`,
      );
    }
  }
}

async function main() {
  logConnectionTarget();

  const pool = new Pool({
    ...postgresPoolOptions(getConnectionString()),
    connectionTimeoutMillis: 20000,
  });

  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    await bootstrapMigrationTracking(client);
    await applyPendingMigrations(client);
    await verifyAnalysisSchema(client);
  } finally {
    client.release();
    await pool.end();
  }

  console.log("[db:migrate] Database migrations complete.");
}

main().catch((error) => {
  console.error("[db:migrate] Failed:", error);
  process.exit(1);
});
