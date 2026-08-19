"use strict";

/**
 * Upload extract markdown only (assembled .md, Docling, vision) to the
 * private extract-artifacts bucket. Skips original PDFs, images, and video.
 * Object keys match paths under data/email-attachments/.
 *
 * Usage:
 *   node scripts/supabase-upload-extract-artifacts.cjs --dry-run
 *   node scripts/supabase-upload-extract-artifacts.cjs
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const sourceRoot = path.join(root, "data", "email-attachments");
const bucket = "extract-artifacts";
const HASH = /^[a-f0-9]{64}$/i;
const CONCURRENCY = 12;

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
    if (key.startsWith("SUPABASE_")) process.env[key] = value;
  }
}

function isExtractArtifact(relPosix) {
  const parts = relPosix.split("/");
  if (parts.length === 1) {
    const name = parts[0];
    return (
      /^[a-f0-9]{64}\.md$/i.test(name) ||
      /^[a-f0-9]{64}\.docling\.md$/i.test(name)
    );
  }
  if (parts.length === 3 && HASH.test(parts[0])) {
    if (parts[1] === "docling" && /^p\d+\.md$/i.test(parts[2])) return true;
    if (parts[1] === "vision" && /^p\d+\.md$/i.test(parts[2])) return true;
  }
  return false;
}

function walk(dir, acc, prefix = "") {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, acc, rel);
    else if (entry.isFile() && isExtractArtifact(rel.replaceAll("\\", "/"))) {
      acc.push({ abs, rel: rel.replaceAll("\\", "/") });
    }
  }
  return acc;
}

function loadServiceRole(projectRef) {
  const cli = path.join(__dirname, "supabase.cjs");
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "projects",
      "api-keys",
      "--project-ref",
      projectRef,
      "--output",
      "json",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "Could not list project API keys.");
  }
  const start = result.stdout.indexOf("[");
  if (start < 0) throw new Error("API keys response was not JSON.");
  const keys = JSON.parse(result.stdout.slice(start));
  const service = keys.find((key) => key.id === "service_role" && key.api_key);
  if (!service?.api_key) {
    throw new Error("No service_role API key on this project.");
  }
  return service.api_key;
}

async function uploadOne(file, projectRef, serviceKey) {
  const objectPath = file.rel.split("/").map(encodeURIComponent).join("/");
  const url = `https://${projectRef}.supabase.co/storage/v1/object/${bucket}/${objectPath}`;
  const body = fs.readFileSync(file.abs);
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "text/markdown; charset=utf-8",
        "x-upsert": "true",
      },
      body,
    });
    if (res.ok) return;
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    const detail = await res.text();
    throw new Error(`${res.status} ${file.rel}: ${detail.slice(0, 200)}`);
  }
}

async function runPool(files, worker) {
  let index = 0;
  let done = 0;
  const failures = [];
  async function workerLoop() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= files.length) return;
      try {
        await worker(files[current]);
      } catch (error) {
        failures.push(
          error instanceof Error ? error.message : String(error),
        );
      }
      done += 1;
      if (done % 500 === 0 || done === files.length) {
        console.log(`Uploaded ${done}/${files.length}`);
      }
    }
  }
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => workerLoop()),
  );
  return failures;
}

async function main() {
  loadEnvLocal();
  const dryRun = process.argv.includes("--dry-run");
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Missing ${sourceRoot}`);
  }
  const files = walk(sourceRoot, []);
  const bytes = files.reduce((sum, file) => sum + fs.statSync(file.abs).size, 0);
  console.log(
    `Extract artifacts: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`,
  );
  if (dryRun) {
    for (const file of files.slice(0, 8)) console.log(`  ${file.rel}`);
    if (files.length > 8) console.log(`  … ${files.length - 8} more`);
    return;
  }
  if (!projectRef) {
    throw new Error("SUPABASE_PROJECT_REF is missing from .env.local.");
  }
  const serviceKey = loadServiceRole(projectRef);
  const failures = await runPool(files, (file) =>
    uploadOne(file, projectRef, serviceKey),
  );
  if (failures.length > 0) {
    console.error(`Failed ${failures.length} files. First: ${failures[0]}`);
    process.exit(1);
  }
  console.log("Upload complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
