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
  return new Pool({
    connectionString: getConnectionString(),
    connectionTimeoutMillis: 5000,
  });
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

async function columnExists(client, tableName, columnName) {
  const { rows } = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    `,
    [tableName, columnName],
  );
  return rows.length > 0;
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
  return /already exists|duplicate key|multiple primary keys|relation .* already exists|violates foreign key constraint|contains null values/i.test(
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

const BASELINE_TABLES = [
  "action_items",
  "analysis_queue",
  "analysis_settings",
  "app_users",
  "budget_categories",
  "budget_line_items",
  "calendar_events",
  "capital_projects",
  "contracts",
  "dev_note_screenshots",
  "dev_notes",
  "discovered_facts",
  "email_attachments",
  "email_forward_queue",
  "email_forward_runs",
  "email_sync_exclusions",
  "email_sync_settings",
  "email_threads",
  "emails",
  "entity_exclusions",
  "entity_mentions",
  "equipment_assets",
  "extracted_action_items",
  "extraction_skill_audit_log",
  "extraction_skill_entries",
  "extraction_skill_versions",
  "extraction_sources",
  "global_todos",
  "gmail_connections",
  "invoices",
  "maintenance_events",
  "meetings",
  "organization_role_definitions",
  "personal_forwarded_messages",
  "resident_issues",
  "sender_allowlist",
  "sync_runs",
  "vendors",
];

async function isBaselineSchemaComplete(client) {
  for (const tableName of BASELINE_TABLES) {
    if (!(await tableExists(client, tableName))) {
      return false;
    }
  }
  return true;
}

async function ensureForeignKey(client, tableName, constraintName, ddl) {
  const { rows } = await client.query(
    `
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = $1
        AND c.contype = 'f'
        AND c.conname = $2
    `,
    [tableName, constraintName],
  );

  if (rows.length > 0) return;

  try {
    await client.query(ddl);
    console.log(`[migrate] Added ${tableName}.${constraintName}.`);
  } catch (error) {
    if (!/already exists/i.test(error.message)) {
      console.warn(
        `[migrate] Could not add ${constraintName}:`,
        error.message,
      );
    }
  }
}

async function applySchemaMigrations(client) {
  const migrations = loadMigrationJournal();
  if (migrations.length === 0) {
    throw new Error(
      "Drizzle migration journal missing from /app/drizzle/meta/_journal.json.",
    );
  }

  await ensureMigrationTable(client);

  for (const migration of migrations) {
    const alreadyApplied = await isMigrationApplied(client, migration.id);
    const schemaComplete = await isBaselineSchemaComplete(client);

    if (alreadyApplied && schemaComplete) {
      console.log(`[migrate] ${migration.id} already applied, skipping.`);
      continue;
    }

    if (alreadyApplied && !schemaComplete) {
      console.log(
        `[migrate] ${migration.id} recorded but schema incomplete; re-applying SQL.`,
      );
    }

    if (!fs.existsSync(migration.file)) {
      throw new Error(`Migration file missing: ${migration.file}`);
    }

    await applyMigrationFile(client, migration.id, migration.file);
  }
}

async function ensureAppUsersEmailUnique(client) {
  if (!(await tableExists(client, "app_users"))) {
    return;
  }

  try {
    await client.query(`
      DELETE FROM app_users a
      USING app_users b
      WHERE a.ctid < b.ctid AND lower(a.email) = lower(b.email)
    `);
  } catch (error) {
    console.warn("[migrate] Could not dedupe app_users emails:", error.message);
  }

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

async function repairExtractionSourcesSchema(client) {
  if (!(await tableExists(client, "extraction_sources"))) return;

  await client.query(`
    ALTER TABLE extraction_sources
    ADD COLUMN IF NOT EXISTS triggered_by_user_id text
  `);

  if (!(await tableExists(client, "app_users"))) return;

  await ensureForeignKey(
    client,
    "extraction_sources",
    "extraction_sources_triggered_by_user_id_app_users_id_fk",
    `
      ALTER TABLE extraction_sources
      ADD CONSTRAINT extraction_sources_triggered_by_user_id_app_users_id_fk
      FOREIGN KEY (triggered_by_user_id) REFERENCES app_users(id)
      ON DELETE no action ON UPDATE no action
    `,
  );
}

async function repairEmailForwardSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS email_forward_runs (
      id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      target_email text NOT NULL,
      source_query text NOT NULL,
      total_queued integer DEFAULT 0 NOT NULL,
      threads_matched integer,
      forwarded_count integer DEFAULT 0 NOT NULL,
      skipped_count integer DEFAULT 0 NOT NULL,
      failed_count integer DEFAULT 0 NOT NULL,
      chunk_size integer DEFAULT 50 NOT NULL,
      chunk_delay_ms integer DEFAULT 120000 NOT NULL,
      next_chunk_at text,
      started_at text NOT NULL,
      finished_at text,
      last_error text
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS email_forward_queue (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      gmail_message_id text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      processed_at text,
      error text
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS personal_forwarded_messages (
      gmail_message_id text PRIMARY KEY NOT NULL,
      gmail_thread_id text,
      forward_run_id text,
      forward_message_id_header text,
      forwarded_at text NOT NULL
    )
  `);

  await ensureForeignKey(
    client,
    "email_forward_queue",
    "email_forward_queue_run_id_email_forward_runs_id_fk",
    `
      ALTER TABLE email_forward_queue
      ADD CONSTRAINT email_forward_queue_run_id_email_forward_runs_id_fk
      FOREIGN KEY (run_id) REFERENCES email_forward_runs(id)
      ON DELETE cascade ON UPDATE no action
    `,
  );

  await ensureForeignKey(
    client,
    "personal_forwarded_messages",
    "personal_forwarded_messages_forward_run_id_email_forward_runs_id_fk",
    `
      ALTER TABLE personal_forwarded_messages
      ADD CONSTRAINT personal_forwarded_messages_forward_run_id_email_forward_runs_id_fk
      FOREIGN KEY (forward_run_id) REFERENCES email_forward_runs(id)
      ON DELETE no action ON UPDATE no action
    `,
  );
}

async function clearOrphanedUserReferences(client) {
  if (!(await tableExists(client, "extraction_sources"))) return;
  if (!(await columnExists(client, "extraction_sources", "triggered_by_user_id"))) {
    return;
  }

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
    await repairExtractionSourcesSchema(client);
    await repairEmailForwardSchema(client);
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

async function runStep(label, fn) {
  try {
    await fn();
    console.log(`[migrate] ${label} OK`);
    return true;
  } catch (error) {
    console.error(`[migrate] ${label} failed:`, error);
    return false;
  }
}

async function verifySoft(client) {
  const missing = [];
  for (const requiredTable of [
    "app_users",
    "meetings",
    "email_sync_settings",
  ]) {
    if (!(await tableExists(client, requiredTable))) {
      missing.push(requiredTable);
    }
  }

  if (missing.length > 0) {
    console.warn(
      `[migrate] Missing tables after setup: ${missing.join(", ")}. Some features may fail until schema is complete.`,
    );
    return false;
  }

  console.log("[migrate] Verified core tables exist.");
  return true;
}

async function run() {
  logConnectionTarget();

  const schemaOk = await runStep("schema migrations", () =>
    withClient(async (client) => {
      await client.query("SELECT 1");
      await applySchemaMigrations(client);
    }),
  );

  const repairOk = await runStep("schema repair", () =>
    withClient(async (client) => {
      await repairAppUsersSchema(client);
      await repairExtractionSourcesSchema(client);
      await repairEmailForwardSchema(client);
      await clearOrphanedUserReferences(client);
    }),
  );

  const verifyOk = await runStep("schema verification", () =>
    withClient(async (client) => verifySoft(client)),
  );

  if (schemaOk && repairOk && verifyOk) {
    console.log("[migrate] Database ready.");
  } else {
    console.warn(
      "[migrate] Database setup finished with errors. App will still start; check logs above.",
    );
  }
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
  const command = process.argv[2] ?? "run";
  if (command === "run") {
    console.warn("[migrate] Continuing despite failure (non-blocking startup).");
    process.exit(0);
  }
  process.exit(1);
});
