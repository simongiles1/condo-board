/**
 * Export a V2 item pipeline debug run to tmp/ for Cursor / offline analysis.
 *
 * Uses DATABASE_URL from .env.local (same DB as the dev server). Does not need
 * a browser session cookie when AUTH_ENABLED=true.
 *
 * Usage:
 *   npx tsx scripts/dump-meeting-v2-item-debug-run.ts <meetingId> <agendaItemId> <runId>
 *   npx tsx scripts/dump-meeting-v2-item-debug-run.ts <meetingId> <agendaItemId> --latest
 *   npx tsx scripts/dump-meeting-v2-item-debug-run.ts --url "http://localhost:3010/operations/meetings/v2/<meetingId>" <agendaItemId> --latest
 *
 * Output: tmp/item-debug-runs/<meetingId>/<agendaItemId>/<runId>.json
 */

import fs from "fs";
import path from "path";

import {
  buildItemDebugAgentBundle,
  loadLatestItemDebugRunId,
} from "../lib/meeting-v2/item-debug";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseMeetingIdFromUrl(value: string): string | null {
  const match = value.match(/\/operations\/meetings\/v2\/([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/dump-meeting-v2-item-debug-run.ts <meetingId> <agendaItemId> <runId>",
      "  npx tsx scripts/dump-meeting-v2-item-debug-run.ts <meetingId> <agendaItemId> --latest",
      "  npx tsx scripts/dump-meeting-v2-item-debug-run.ts --url <meetingPageUrl> <agendaItemId> --latest",
    ].join("\n"),
  );
  process.exit(1);
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  if (args.length < 2) usage();

  let meetingId: string | null = null;
  let rest = args;
  if (args[0] === "--url") {
    if (args.length < 3) usage();
    meetingId = parseMeetingIdFromUrl(args[1]);
    if (!meetingId) {
      console.error("Could not parse meeting id from --url.");
      process.exit(1);
    }
    rest = args.slice(2);
  } else {
    meetingId = args[0];
    rest = args.slice(1);
  }

  if (rest.length < 2) usage();
  const agendaItemId = rest[0];
  const runToken = rest[1];
  let runId = runToken;
  if (runToken === "--latest") {
    const latest = await loadLatestItemDebugRunId(meetingId, agendaItemId);
    if (!latest) {
      console.error("No debug runs found for this agenda item.");
      process.exit(1);
    }
    runId = latest;
  }

  const bundle = await buildItemDebugAgentBundle(meetingId, agendaItemId, runId);
  const outDir = path.join(
    process.cwd(),
    "tmp",
    "item-debug-runs",
    meetingId,
    agendaItemId,
  );
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${runId}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  console.log(outPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
