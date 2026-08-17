/**
 * Run Tier 2 page vision on pending attachment_document_pages.
 *
 * Usage:
 *   npx tsx scripts/run-page-vision.ts
 *   npx tsx scripts/run-page-vision.ts --limit=20
 *   npx tsx scripts/run-page-vision.ts --hash=<sha256>
 *   npx tsx scripts/run-page-vision.ts --dry-run
 *   npx tsx scripts/run-page-vision.ts --all   # loop until no pending (costly)
 */

import path from "path";

import { eq, sql } from "drizzle-orm";

import { getDb } from "../lib/db";
import { attachmentDocumentPages } from "../lib/db/schema";
import { processPendingVisionBatch } from "../lib/email/page-vision";
import { pageVisionBatchSizeFromEnv } from "../lib/email/page-vision-shared";

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

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function countPending(onlyHash?: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachmentDocumentPages)
    .where(
      onlyHash
        ? sql`${attachmentDocumentPages.visionStatus} = 'pending' AND ${attachmentDocumentPages.contentHash} = ${onlyHash}`
        : eq(attachmentDocumentPages.visionStatus, "pending"),
    );
  return row?.count ?? 0;
}

async function main() {
  const dryRun = hasFlag("dry-run");
  const all = hasFlag("all");
  const onlyHash = argValue("hash");
  const limitRaw = argValue("limit");
  const batchSize = pageVisionBatchSizeFromEnv();
  const maxPages = all
    ? Number.POSITIVE_INFINITY
    : Number(limitRaw ?? String(batchSize));

  if (!Number.isFinite(maxPages) || maxPages < 1) {
    console.error("Invalid --limit");
    process.exit(1);
  }

  const pendingBefore = await countPending(onlyHash);
  console.log(
    `[page-vision] pending=${pendingBefore}` +
      (onlyHash ? ` hash=${onlyHash.slice(0, 12)}…` : "") +
      (dryRun ? " dry-run" : "") +
      ` batchSize=${batchSize} maxPages=${all ? "∞" : maxPages}`,
  );

  let remainingBudget = maxPages;
  let totalDone = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalCost = 0;
  const merged = new Set<string>();

  while (remainingBudget > 0) {
    const thisBatch = Math.min(batchSize, remainingBudget);
    const result = await processPendingVisionBatch({
      batchSize: thisBatch,
      contentHash: onlyHash,
      dryRun,
    });

    if (result.processed === 0) {
      console.log("[page-vision] no more pending pages");
      break;
    }

    totalDone += result.done;
    totalFailed += result.failed;
    totalSkipped += result.skipped;
    totalCost += result.costUsd;
    for (const h of result.mergedHashes) merged.add(h);

    console.log(
      `[page-vision] batch processed=${result.processed} done=${result.done} failed=${result.failed} skipped=${result.skipped} cost=$${result.costUsd.toFixed(4)} merged=${result.mergedHashes.length}`,
    );

    for (const page of result.pages) {
      const short = page.contentHash.slice(0, 12);
      const tag =
        page.status === "done"
          ? "✓"
          : page.status === "skipped"
            ? "○"
            : "✗";
      console.log(
        `  ${tag} ${short}… p${page.pageNo}` +
          (page.error ? ` — ${page.error}` : "") +
          (page.costUsd > 0 ? ` ($${page.costUsd.toFixed(4)})` : ""),
      );
    }

    remainingBudget -= result.processed;
    if (dryRun || !all) break;
  }

  console.log(
    `[page-vision] summary done=${totalDone} failed=${totalFailed} skipped=${totalSkipped} cost=$${totalCost.toFixed(4)} mergedHashes=${merged.size}`,
  );
}

main().catch((error) => {
  console.error("[page-vision] fatal:", error);
  process.exit(1);
});
