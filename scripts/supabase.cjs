"use strict";

/**
 * Runs the project-local Supabase CLI with credentials from `.env.local`.
 *
 * SUPABASE_* keys in `.env.local` override the process environment so a
 * global PAT, `supabase login` keyring, or Cursor MCP cannot hit the
 * PlaySquare account while working in this repo.
 *
 * Usage: npm run supabase -- projects list
 *        npm run supabase -- link
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;

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

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is missing. Create a PAT at https://supabase.com/dashboard/account/tokens on the Condo Board account (not PlaySquare) and put it in .env.local.",
  );
  process.exit(1);
}
if (!token.startsWith("sbp_")) {
  console.error(
    "SUPABASE_ACCESS_TOKEN must be a personal access token starting with sbp_. Do not use the anon or service_role API keys.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  args.push("--help");
}

const isLink = args[0] === "link";
const hasProjectRef = args.some(
  (arg) => arg === "--project-ref" || arg.startsWith("--project-ref="),
);
if (args[0] === "storage" && !args.includes("--experimental")) {
  args.push("--experimental");
}

if (isLink && !hasProjectRef) {
  const ref = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!ref) {
    console.error(
      "supabase link needs SUPABASE_PROJECT_REF in .env.local (Dashboard → Project Settings → General → Reference ID).",
    );
    process.exit(1);
  }
  args.push("--project-ref", ref);
}

const bin = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
if (!fs.existsSync(bin)) {
  console.error("Supabase CLI is not installed. Run npm install.");
  process.exit(1);
}

const child = spawn(process.execPath, [bin, ...args], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
