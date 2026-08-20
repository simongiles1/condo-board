import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pool?: Pool;
  db?: NodePgDatabase<typeof schema>;
  databaseUrl?: string;
};

function resolveDatabaseUrl(): string {
  // Local `npm run dev` and Coolify both use the same Supabase URI
  // (DATABASE_URL / COND_BOARD_POSTGRES_URL). Compose Postgres on
  // localhost:5433 is rollback-only — do not point app data at it.
  const connectionString =
    process.env.COND_BOARD_POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required (Supabase URI with sslmode=require, same as Coolify).",
    );
  }
  if (connectionString.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL still points at SQLite (file:...). Update .env.local to a Postgres URL, start Postgres, then run npm run db:migrate.",
    );
  }
  return connectionString;
}

/**
 * Windows TLS inspection treats the pooler's cert as a self-signed chain,
 * and node-pg 8 aliases sslmode=require to verify-full. Strip sslmode and
 * relax verification only on win32 → Supabase. Coolify Linux keeps URI SSL.
 */
export function postgresPoolOptions(connectionString: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
} {
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

function getPool(): Pool {
  const connectionString = resolveDatabaseUrl();
  if (globalForDb.pool && globalForDb.databaseUrl !== connectionString) {
    void globalForDb.pool.end();
    globalForDb.pool = undefined;
    globalForDb.db = undefined;
  }
  if (!globalForDb.pool) {
    // Fail fast on a dead peer instead of waiting ~30s for TCP timeout.
    globalForDb.pool = new Pool({
      ...postgresPoolOptions(connectionString),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 20_000,
    });
    globalForDb.databaseUrl = connectionString;
  }
  return globalForDb.pool;
}

/** Server-only: Postgres client for API routes / server components. */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalForDb.db) {
    globalForDb.db = drizzle(getPool(), { schema });
  }
  return globalForDb.db;
}
