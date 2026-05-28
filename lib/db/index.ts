import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  sqlite?: Database.Database;
};

export function sqlitePathFromEnv(): string {
  const raw = process.env.DATABASE_URL ?? "file:./data/app.db";
  return raw.startsWith("file:") ? raw.slice("file:".length) : raw;
}

function getSqlite(): Database.Database {
  if (!globalForDb.sqlite) {
    const path = sqlitePathFromEnv();
    globalForDb.sqlite = new Database(path);
  }
  return globalForDb.sqlite;
}

/** Server-only: synchronous SQLite client for API routes / server components. */
export function getDb() {
  return drizzle(getSqlite(), { schema });
}

/** Run migrations/table creation on startup if needed — drizzle-kit push handles schema. */
