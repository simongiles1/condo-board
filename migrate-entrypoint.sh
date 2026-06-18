#!/bin/sh
set -e

if [ -n "$COMPOSE_DATABASE_URL" ]; then
  export DATABASE_URL="$COMPOSE_DATABASE_URL"
fi

node <<'EOF'
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

output="$(npx drizzle-kit push 2>&1)" || exit 1
printf '%s\n' "$output"
if printf '%s\n' "$output" | grep -q '^error:'; then
  exit 1
fi
