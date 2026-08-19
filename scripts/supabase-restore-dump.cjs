"use strict";

/**
 * Restore a pg_dump custom-format file into the linked Supabase project.
 * Reads SUPABASE_* from .env.local. Does not print the database password.
 *
 * Usage: node scripts/supabase-restore-dump.cjs tmp/condo-public.dump
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.local is missing.");
  }
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.startsWith("SUPABASE_")) {
      process.env[key] = value;
    } else if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const dumpPath = path.resolve(process.argv[2] || path.join(root, "tmp", "condo-public.dump"));
if (!fs.existsSync(dumpPath)) {
  throw new Error(`Dump file not found: ${dumpPath}`);
}

const ref = process.env.SUPABASE_PROJECT_REF?.trim();
const password = process.env.SUPABASE_DB_PASSWORD?.trim();
if (!ref || !password) {
  throw new Error(
    "SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD are required in .env.local.",
  );
}

const dumpDir = path.dirname(dumpPath);
const dumpName = path.basename(dumpPath);

console.log(`Restoring ${dumpName} into linked project ${ref} (public schema).`);

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    `${dumpDir}:/dump`,
    "-e",
    `PGPASSWORD=${password}`,
    "postgres:16-alpine",
    "pg_restore",
    "--no-owner",
    "--no-acl",
    "--dbname",
    `postgresql://postgres.${ref}@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require`,
    `/dump/${dumpName}`,
  ],
  { encoding: "utf8" },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  throw result.error;
}

const stderr = result.stderr ?? "";
const onlyPublicSchemaExists =
  result.status === 1 &&
  stderr.includes('schema "public" already exists') &&
  /errors ignored on restore: 1\s*$/.test(stderr);
if (onlyPublicSchemaExists) {
  console.log("Restore finished. Ignored CREATE SCHEMA public (already exists).");
  process.exit(0);
}
if (result.status !== 0 && result.status !== null) {
  process.exit(result.status);
}
