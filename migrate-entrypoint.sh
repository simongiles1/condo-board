#!/bin/sh
set -e

export DATABASE_URL="${COMPOSE_DATABASE_URL:-postgresql://condo:condo@db:5432/condo_board}"

node <<'EOF' || echo "[migrate] Skipped orphaned user cleanup."
const { Pool } = require("pg");

async function clearOrphanedUserReferences() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      SELECT
        to_regclass('public.extraction_sources') IS NOT NULL AS has_sources,
        to_regclass('public.app_users') IS NOT NULL AS has_users
    `);
    const { has_sources, has_users } = rows[0] ?? {};
    if (!has_sources) return;

    if (!has_users) {
      await pool.query(`
        UPDATE extraction_sources
        SET triggered_by_user_id = NULL
        WHERE triggered_by_user_id IS NOT NULL
      `);
      return;
    }

    await pool.query(`
      UPDATE extraction_sources
      SET triggered_by_user_id = NULL
      WHERE triggered_by_user_id IS NOT NULL
        AND triggered_by_user_id NOT IN (SELECT id FROM app_users)
    `);
  } finally {
    await pool.end();
  }
}

clearOrphanedUserReferences().catch((error) => {
  console.error("[migrate] Failed to clear orphaned user references:", error);
  process.exit(1);
});
EOF

npx drizzle-kit push

node <<'EOF'
const { Pool } = require("pg");

async function verifyAuthTables() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      SELECT to_regclass('public.app_users') IS NOT NULL AS has_app_users
    `);
    if (!rows[0]?.has_app_users) {
      console.error("[migrate] app_users table is missing after drizzle push.");
      process.exit(1);
    }
    console.log("[migrate] Verified app_users table exists.");
  } finally {
    await pool.end();
  }
}

verifyAuthTables().catch((error) => {
  console.error("[migrate] Failed to verify auth tables:", error);
  process.exit(1);
});
EOF
