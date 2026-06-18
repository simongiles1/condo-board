import { createHash } from "crypto";
import { readFileSync } from "fs";
import pg from "pg";

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
    // .env.local optional for scripts run with explicit env
  }
}

function hashPassword(password, secret) {
  return createHash("sha256")
    .update(`${secret}:${password}`)
    .digest("hex");
}

loadEnvLocal();

const email = process.argv[2]?.trim().toLowerCase();
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: node scripts/reset-local-password.mjs <email> <new-password>");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const authSecret = process.env.AUTH_SECRET ?? "dev";
const connectionString =
  process.env.COND_BOARD_POSTGRES_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://condo:condo@localhost:5433/condo_board";

const pool = new pg.Pool({ connectionString });

try {
  const { rowCount } = await pool.query(
    "UPDATE app_users SET password_hash = $1 WHERE email = $2",
    [hashPassword(password, authSecret), email],
  );

  if (rowCount === 0) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }

  console.log(`Updated password for ${email}`);
  console.log(`Database: ${connectionString.replace(/:[^:@/]+@/, ":***@")}`);
  console.log(`AUTH_SECRET: ${authSecret ? "(set)" : "(missing — using dev fallback)"}`);
} finally {
  await pool.end();
}
