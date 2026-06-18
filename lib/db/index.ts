import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pool?: Pool;
  db?: NodePgDatabase<typeof schema>;
  databaseUrl?: string;
};

function resolveDatabaseUrl(): string {
  const connectionString =
    process.env.COND_BOARD_POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required (e.g. postgresql://condo:condo@localhost:5433/condo_board)",
    );
  }
  if (connectionString.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL still points at SQLite (file:...). Update .env.local to a Postgres URL, start Postgres, then run npm run db:push.",
    );
  }
  return connectionString;
}

function getPool(): Pool {
  const connectionString = resolveDatabaseUrl();
  if (globalForDb.pool && globalForDb.databaseUrl !== connectionString) {
    void globalForDb.pool.end();
    globalForDb.pool = undefined;
    globalForDb.db = undefined;
  }
  if (!globalForDb.pool) {
    globalForDb.pool = new Pool({ connectionString });
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
