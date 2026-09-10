/**
 * Live IBM Docling probe for one env key slot (no key rotation / no DB exhaustion writes).
 *
 *   npx tsx scripts/probe-ibm-docling-slot.ts
 *   npx tsx scripts/probe-ibm-docling-slot.ts 5
 */
import fs from "fs";
import path from "path";

import { getDb } from "../lib/db";
import { ibmDoclingAccounts } from "../lib/db/schema";
import {
  listIbmDoclingCredentials,
  probeIbmDoclingSlot,
} from "../lib/email/docling-ibm";
import { listOrderedIbmCredentials } from "../lib/email/ibm-docling-slots";
import { eq } from "drizzle-orm";

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
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** Minimal valid one-page PDF for a cheap convert probe. */
const MINIMAL_PDF = Buffer.from(
  `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 300 300]/Parent 2 0 R>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
178
%%EOF`,
  "utf8",
);

async function main() {
  loadEnvLocal();
  const slot = Math.max(
    1,
    Math.floor(Number(process.argv[2] ?? "5") || 5),
  );

  const creds = listIbmDoclingCredentials();
  const ordered = await listOrderedIbmCredentials();
  const db = getDb();
  const [row] = await db
    .select({
      billedPages: ibmDoclingAccounts.billedPages,
      trialPages: ibmDoclingAccounts.trialPages,
      exhaustedAt: ibmDoclingAccounts.exhaustedAt,
      exhaustedReason: ibmDoclingAccounts.exhaustedReason,
      isActive: ibmDoclingAccounts.isActive,
    })
    .from(ibmDoclingAccounts)
    .where(eq(ibmDoclingAccounts.envSlot, slot))
    .limit(1);

  console.log("=== IBM Docling slot probe ===");
  console.log(
    JSON.stringify(
      {
        slot,
        keysInEnv: creds.map((c) => c.slot),
        appWouldTrySlotsFirst: ordered.map((c) => c.slot),
        dbAccount: row ?? null,
        keyConfigured: creds.some((c) => c.slot === slot),
      },
      null,
      2,
    ),
  );

  const result = await probeIbmDoclingSlot(slot, MINIMAL_PDF);
  console.log("\n=== Probe result (raw IBM responses) ===");
  console.log(JSON.stringify(result, null, 2));

  if (!result.convert.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
