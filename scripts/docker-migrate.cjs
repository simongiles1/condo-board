const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const MIGRATION_TABLE = "__condo_board_migrations";

function getConnectionString() {
  return (
    process.env.COND_BOARD_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgresql://condo:condo@db:5432/condo_board"
  );
}

function getPool() {
  return new Pool({ connectionString: getConnectionString() });
}

function logConnectionTarget() {
  try {
    const { hostname, port, pathname } = new URL(getConnectionString());
    console.log(
      `[migrate] Using Postgres at ${hostname}:${port}${pathname}`,
    );
  } catch {
    console.log("[migrate] Using configured Postgres connection string.");
  }
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return Boolean(rows[0]?.exists);
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      id text PRIMARY KEY NOT NULL,
      applied_at text NOT NULL
    )
  `);
}

async function isMigrationApplied(client, id) {
  const { rows } = await client.query(
    `SELECT 1 FROM ${MIGRATION_TABLE} WHERE id = $1`,
    [id],
  );
  return rows.length > 0;
}

async function markMigrationApplied(client, id) {
  await client.query(
    `INSERT INTO ${MIGRATION_TABLE} (id, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, new Date().toISOString()],
  );
}

function loadMigrationJournal() {
  const journalPath = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    return [];
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  return journal.entries.map((entry) => ({
    id: entry.tag,
    file: path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
  }));
}

function splitSqlStatements(sql) {
  return sql
    .split(/--> statement-breakpoint\n?/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function isIgnorableMigrationError(message) {
  return /already exists|duplicate key|multiple primary keys|relation .* already exists/i.test(
    message,
  );
}

async function applyMigrationFile(client, migrationId, filePath) {
  const sql = fs.readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(sql);
  console.log(
    `[migrate] Applying ${migrationId} (${statements.length} statements)...`,
  );

  for (const statement of statements) {
    try {
      await client.query(statement);
    } catch (error) {
      if (isIgnorableMigrationError(error.message)) {
        console.warn(
          `[migrate] Skipping existing object: ${error.message.split("\n")[0]}`,
        );
        continue;
      }
      throw error;
    }
  }

  await markMigrationApplied(client, migrationId);
  console.log(`[migrate] Applied ${migrationId}.`);
}

async function applySchemaMigrations(client) {
  const migrations = loadMigrationJournal();
  if (migrations.length === 0) {
    console.warn("[migrate] No drizzle migration journal found; skipping baseline SQL.");
    return;
  }

  await ensureMigrationTable(client);

  for (const migration of migrations) {
    if (await isMigrationApplied(client, migration.id)) {
      console.log(`[migrate] ${migration.id} already applied, skipping.`);
      continue;
    }

    if (
      migration.id.startsWith("0000") &&
      (await tableExists(client, "meetings"))
    ) {
      console.log(
        "[migrate] Existing schema detected; marking baseline migration applied.",
      );
      await markMigrationApplied(client, migration.id);
      continue;
    }

    if (!fs.existsSync(migration.file)) {
      throw new Error(`Migration file missing: ${migration.file}`);
    }

    await applyMigrationFile(client, migration.id, migration.file);
  }
}

async function ensureAppUsersEmailUnique(client) {
  await client.query(`
    DELETE FROM app_users a
    USING app_users b
    WHERE a.ctid < b.ctid AND lower(a.email) = lower(b.email)
  `);

  const { rows } = await client.query(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'app_users' AND c.contype = 'u'
  `);

  if (rows.some((row) => row.conname === "app_users_email_unique")) return;

  const legacy = rows.find((row) => row.def.includes("(email)"));
  if (legacy) {
    const name = legacy.conname.replace(/"/g, "");
    try {
      await client.query(
        `ALTER TABLE app_users RENAME CONSTRAINT "${name}" TO app_users_email_unique`,
      );
      console.log("[migrate] Renamed email unique constraint to app_users_email_unique.");
    } catch (error) {
      console.warn("[migrate] Could not rename email unique constraint:", error.message);
    }
    return;
  }

  try {
    await client.query(`
      ALTER TABLE app_users
      ADD CONSTRAINT app_users_email_unique UNIQUE (email)
    `);
    console.log("[migrate] Added app_users_email_unique constraint.");
  } catch (error) {
    if (!/already exists/i.test(error.message)) {
      throw error;
    }
  }
}

async function repairAppUsersSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      password_hash text NOT NULL,
      first_name text,
      last_name text,
      role text NOT NULL DEFAULT 'user',
      created_at text NOT NULL
    )
  `);

  for (const [name, type] of [
    ["password_hash", "text"],
    ["first_name", "text"],
    ["last_name", "text"],
    ["role", "text DEFAULT 'user'"],
    ["created_at", "text"],
  ]) {
    await client.query(
      `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS ${name} ${type}`,
    );
  }

  await ensureAppUsersEmailUnique(client);

  const { rows: checks } = await client.query(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'app_users' AND c.contype = 'c'
  `);

  for (const row of checks) {
    if (row.def.includes("role") && !row.def.includes("super_admin")) {
      const name = row.conname.replace(/"/g, "");
      await client.query(`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS "${name}"`);
      console.log(`[migrate] Dropped outdated role constraint: ${name}`);
    }
  }
}

async function clearOrphanedUserReferences(client) {
  if (!(await tableExists(client, "extraction_sources"))) return;

  const hasUsers = await tableExists(client, "app_users");
  if (!hasUsers) {
    await client.query(`
      UPDATE extraction_sources
      SET triggered_by_user_id = NULL
      WHERE triggered_by_user_id IS NOT NULL
    `);
    return;
  }

  await client.query(`
    UPDATE extraction_sources
    SET triggered_by_user_id = NULL
    WHERE triggered_by_user_id IS NOT NULL
      AND triggered_by_user_id NOT IN (SELECT id FROM app_users)
  `);
}

async function withClient(fn) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function prepare() {
  await withClient(async (client) => {
    await client.query("SELECT 1");
    await applySchemaMigrations(client);
    await repairAppUsersSchema(client);
    await clearOrphanedUserReferences(client);
    console.log("[migrate] Prepared database schema.");
  });
}

async function verify() {
  await withClient(async (client) => {
    await repairAppUsersSchema(client);

    if (!(await tableExists(client, "app_users"))) {
      throw new Error("app_users table is missing after migration.");
    }

    const { rows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'app_users'
    `);
    const columns = new Set(rows.map((row) => row.column_name));
    for (const required of [
      "email",
      "password_hash",
      "first_name",
      "last_name",
      "role",
      "created_at",
    ]) {
      if (!columns.has(required)) {
        throw new Error(`app_users is missing required column: ${required}`);
      }
    }

    for (const requiredTable of [
      "app_users",
      "meetings",
      "email_sync_settings",
    ]) {
      if (!(await tableExists(client, requiredTable))) {
        throw new Error(`${requiredTable} table is missing after migration.`);
      }
    }

    console.log("[migrate] Verified core tables exist.");
  });
}

async function run() {
  logConnectionTarget();
  await prepare();
  await verify();
  console.log("[migrate] Database ready.");
}

async function main() {
  const command = process.argv[2] ?? "run";
  if (command === "prepare") {
    await prepare();
    return;
  }
  if (command === "verify") {
    await verify();
    return;
  }
  if (command === "run") {
    await run();
    return;
  }

  throw new Error("Usage: node scripts/docker-migrate.cjs [run|prepare|verify]");
}

main().catch((error) => {
  console.error("[migrate] Failed:", error);
  process.exit(1);
});
