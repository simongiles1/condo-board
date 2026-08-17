/**
 * Promote completed Docling/vision backfill docs to parse_status=parsed.
 *
 * Usage:
 *   npx tsx scripts/promote-extraction-parsed.ts
 *   npx tsx scripts/promote-extraction-parsed.ts --dry-run
 */

import path from "path";

import {
  listOpenHashesFromCompletedBackfills,
  promoteOpenCompletedBackfillDocs,
} from "../lib/email/extraction-parse-promote";

function loadEnvLocal() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
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
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    const hashes = await listOpenHashesFromCompletedBackfills();
    console.log(`Would consider ${hashes.length} open backfill doc(s).`);
    return;
  }

  const result = await promoteOpenCompletedBackfillDocs();
  console.log(
    `Promoted ${result.promoted} of ${result.considered} open backfill doc(s).`,
  );
  console.log("Skip reasons:", result.skipped);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
