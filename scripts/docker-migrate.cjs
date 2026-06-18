const { Pool } = require("pg");

function getPool() {
  const connectionString =
    process.env.COND_BOARD_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgresql://condo:condo@db:5432/condo_board";

  return new Pool({ connectionString });
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return Boolean(rows[0]?.exists);
}

async function repairAppUsersSchema(client) {
  if (!(await tableExists(client, "app_users"))) return;

  await client.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS first_name text`);
  await client.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_name text`);

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

async function prepare() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await repairAppUsersSchema(client);
    await clearOrphanedUserReferences(client);
    console.log("[migrate] Prepared database for schema push.");
  } finally {
    client.release();
    await pool.end();
  }
}

async function verify() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    if (!(await tableExists(client, "app_users"))) {
      console.error("[migrate] app_users table is missing after drizzle push.");
      process.exit(1);
    }

    const { rows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'app_users'
    `);
    const columns = new Set(rows.map((row) => row.column_name));
    for (const required of ["email", "password_hash", "role", "created_at"]) {
      if (!columns.has(required)) {
        console.error(`[migrate] app_users is missing required column: ${required}`);
        process.exit(1);
      }
    }

    console.log("[migrate] Verified app_users table exists.");
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "prepare") {
    await prepare();
    return;
  }
  if (command === "verify") {
    await verify();
    return;
  }

  console.error("[migrate] Usage: node scripts/docker-migrate.cjs <prepare|verify>");
  process.exit(1);
}

main().catch((error) => {
  console.error("[migrate] Failed:", error);
  process.exit(1);
});
