import pg from "pg";
import { readFileSync } from "fs";

function loadEnvLocal() {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

const connectionString =
  process.env.COND_BOARD_POSTGRES_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://condo:condo@localhost:5433/condo_board";

const pool = new pg.Pool({ connectionString });

try {
  const masked = connectionString.replace(/:[^:@/]+@/, ":***@");
  console.log("Database:", masked);
  console.log("AUTH_ENABLED:", process.env.AUTH_ENABLED ?? "(unset)");
  console.log("AUTH_SECRET:", process.env.AUTH_SECRET ? "(set)" : "(unset — passwords hash with dev fallback)");

  const users = await pool.query(
    "SELECT email, role, created_at FROM app_users ORDER BY created_at",
  );
  console.log("User count:", users.rowCount);
  for (const row of users.rows) {
    console.log(`  - ${row.email} (${row.role}) created ${row.created_at}`);
  }

  const tables = await pool.query(
    "SELECT to_regclass('public.app_users') AS app_users_table",
  );
  console.log("app_users table:", tables.rows[0]?.app_users_table ?? "MISSING");
} finally {
  await pool.end();
}
